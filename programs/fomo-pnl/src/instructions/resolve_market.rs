use anchor_lang::prelude::*;
use anchor_spl::token::{transfer, Mint, Token, TokenAccount, Transfer};

use crate::error::PredictionMarketError;
use crate::settle::rake_split;
use crate::state::{Config, Market, MarketState, Outcome, Rake};

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct ResolveMarket<'info> {
    #[account(constraint = resolver.key() == config.resolver @ PredictionMarketError::InvalidResolver)]
    pub resolver: Signer<'info>,

    #[account(seeds = [Config::SEED], bump = config.bump)]
    pub config: Account<'info, Config>,

    #[account(seeds = [Rake::SEED], bump = rake.bump)]
    pub rake: Account<'info, Rake>,

    #[account(
        mut,
        seeds = [Market::SEED, market_id.to_le_bytes().as_ref()],
        bump = market.bump,
        constraint = market.state == MarketState::Active @ PredictionMarketError::MarketAlreadyFinalized
    )]
    pub market: Account<'info, Market>,

    #[account(
        mut,
        seeds = [Market::VAULT_SEED, market_id.to_le_bytes().as_ref()],
        bump = market.vault_bump,
        token::mint = token_mint,
        token::authority = market
    )]
    pub market_vault: Account<'info, TokenAccount>,

    #[account(constraint = token_mint.key() == config.token_mint)]
    pub token_mint: Account<'info, Mint>,

    /// CHECK: USDC ATA for the current founder. Validated in the handler so it
    /// may be the same account as `creator_token` when founder opened the pot.
    #[account(mut)]
    pub founder_token: UncheckedAccount<'info>,

    #[account(
        mut,
        constraint = burn_token.key() == rake.burn_treasury @ PredictionMarketError::InvalidTokenAccount
    )]
    pub burn_token: Account<'info, TokenAccount>,

    #[account(
        mut,
        constraint = agent_token.key() == rake.agent_treasury @ PredictionMarketError::InvalidTokenAccount
    )]
    pub agent_token: Account<'info, TokenAccount>,

    /// CHECK: USDC ATA for `market.creator`. May equal `founder_token`.
    #[account(mut)]
    pub creator_token: UncheckedAccount<'info>,

    pub token_program: Program<'info, Token>,
}

fn require_usdc_ata(info: &AccountInfo, mint: Pubkey, owner: Pubkey) -> Result<()> {
    require_keys_eq!(
        *info.owner,
        anchor_spl::token::ID,
        PredictionMarketError::InvalidTokenAccount
    );
    let acc = TokenAccount::try_deserialize(&mut &info.data.borrow()[..])
        .map_err(|_| error!(PredictionMarketError::InvalidTokenAccount))?;
    require!(acc.mint == mint, PredictionMarketError::InvalidTokenAccount);
    require!(acc.owner == owner, PredictionMarketError::InvalidTokenAccount);
    Ok(())
}

fn pay_from_vault<'info>(
    amount: u64,
    vault: &Account<'info, TokenAccount>,
    dest: AccountInfo<'info>,
    market: &Account<'info, Market>,
    market_id: u64,
    token_program: &Program<'info, Token>,
) -> Result<()> {
    if amount == 0 {
        return Ok(());
    }
    let market_id_bytes = market_id.to_le_bytes();
    let seeds = &[Market::SEED, market_id_bytes.as_ref(), &[market.bump]];
    let signer_seeds = &[&seeds[..]];
    transfer(
        CpiContext::new_with_signer(
            token_program.to_account_info(),
            Transfer {
                from: vault.to_account_info(),
                to: dest,
                authority: market.to_account_info(),
            },
            signer_seeds,
        ),
        amount,
    )
}

pub fn handler(
    ctx: Context<ResolveMarket>,
    market_id: u64,
    end_pnl_usd: i64,
    captured_at: i64,
) -> Result<()> {
    let clock = Clock::get()?;
    require!(
        crate::settle::can_resolve_now(
            clock.unix_timestamp,
            ctx.accounts.market.resolution_time,
            ctx.accounts.market.window,
            end_pnl_usd,
            ctx.accounts.market.threshold_usd,
        ),
        PredictionMarketError::MarketNotExpired
    );

    if ctx.accounts.market.yes_pool == 0 || ctx.accounts.market.no_pool == 0 {
        ctx.accounts.market.state = MarketState::Cancelled;
        ctx.accounts.market.rake_total = 0;
        return Ok(());
    }

    let mint = ctx.accounts.config.token_mint;
    require_usdc_ata(
        &ctx.accounts.founder_token.to_account_info(),
        mint,
        ctx.accounts.rake.founder,
    )?;
    require_usdc_ata(
        &ctx.accounts.creator_token.to_account_info(),
        mint,
        ctx.accounts.market.creator,
    )?;

    let winning = crate::settle::winning_outcome(end_pnl_usd, ctx.accounts.market.threshold_usd);
    let losing_pool = if winning == Outcome::Yes {
        ctx.accounts.market.no_pool
    } else {
        ctx.accounts.market.yes_pool
    };
    let split = rake_split(
        losing_pool,
        ctx.accounts.market.founder_bps,
        ctx.accounts.market.burn_bps,
        ctx.accounts.market.agent_bps,
        ctx.accounts.market.creator_bps,
    )
    .map_err(|e| error!(e))?;
    let rake_total = split.total().map_err(|e| error!(e))?;

    pay_from_vault(
        split.burn,
        &ctx.accounts.market_vault,
        ctx.accounts.burn_token.to_account_info(),
        &ctx.accounts.market,
        market_id,
        &ctx.accounts.token_program,
    )?;
    pay_from_vault(
        split.agent,
        &ctx.accounts.market_vault,
        ctx.accounts.agent_token.to_account_info(),
        &ctx.accounts.market,
        market_id,
        &ctx.accounts.token_program,
    )?;

    let founder_key = ctx.accounts.founder_token.key();
    let creator_key = ctx.accounts.creator_token.key();
    if founder_key == creator_key {
        let combined = split
            .founder
            .checked_add(split.creator)
            .ok_or(PredictionMarketError::Overflow)?;
        pay_from_vault(
            combined,
            &ctx.accounts.market_vault,
            ctx.accounts.founder_token.to_account_info(),
            &ctx.accounts.market,
            market_id,
            &ctx.accounts.token_program,
        )?;
    } else {
        pay_from_vault(
            split.founder,
            &ctx.accounts.market_vault,
            ctx.accounts.founder_token.to_account_info(),
            &ctx.accounts.market,
            market_id,
            &ctx.accounts.token_program,
        )?;
        pay_from_vault(
            split.creator,
            &ctx.accounts.market_vault,
            ctx.accounts.creator_token.to_account_info(),
            &ctx.accounts.market,
            market_id,
            &ctx.accounts.token_program,
        )?;
    }

    let market = &mut ctx.accounts.market;
    market.end_pnl_usd = end_pnl_usd;
    market.captured_at = captured_at;
    market.winning_outcome = winning;
    market.state = MarketState::Resolved;
    market.rake_total = rake_total;
    Ok(())
}
