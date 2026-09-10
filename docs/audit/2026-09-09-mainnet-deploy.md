# Mainnet deploy — 2026-09-09

**Program id (mainnet-beta):** `CnJCzEEpfxtDWex5rA5c1H5A5YZQPqSG2LjnhxwRLMQM`
**ProgramData:** `HcnPCQtUDNSJahRVmv1pJ5h29Ep9sKVXLtoYr1tSRcWZ`
**Source commit:** `3ce3ee866ff76e4c1c3ca6279484edb0cb40f249` (public repo HEAD at deploy time)

## What is deployed

- Binary: 390,976 bytes, `opt-level = "z"`, SHA-256
  `f23feb3e2a5e0868329ed32fc895f10b3e59a418552b285a108a4a9d862e2350`.
- ProgramData allocated 394,880 bytes (10,240-byte extend headroom beyond the
  binary; trailing bytes are zero).
- Rent tied up: 2.502 SOL (mainnet rate ≈ 6,333 lamports/byte — notably higher
  than devnet's 5,080; early cost estimates measured devnet and were low).
- Upgrade authority: deploy wallet `FMMktQmbEQwc8yZnnTWxahy1QY7YhGzRDJnztprJwvZY`,
  **pending handoff** (Squads multisig or freeze) after mainnet testing
  completes. Until then the deploy key can upgrade or freeze the program.
- On-chain IDL published at `DcwRLXVLjqhoek9uwFShSkgymCqnQdpYX1hsbLZQUmJw`
  (authority: deploy wallet) so explorers and multisig UIs decode instructions.

## Verification chain (all reproducible)

1. `solana program dump` of the mainnet program, truncated to the 390,976-byte
   binary (dump includes zero padding up to the allocation), hashes to
   `f23feb3e…`.
2. `anchor build --verifiable` (Docker) from the local tree at `3ce3ee8`
   produces `target/verifiable/fomo_pnl.so` with the same hash.
3. `anchor build --verifiable` from a fresh anonymous clone of
   `github.com/fraserbrownirl/ngmi` at `3ce3ee8` produces the same hash.

A stranger can therefore reproduce the on-chain bytes from the public repo.
Note: `anchor build --verifiable` writes to `target/verifiable/`, not
`target/deploy/` — deploys must pass that path explicitly.

## Incident: wrong artifact in the first deploy

The first deploy (slot 445584423) uploaded `target/deploy/fomo_pnl.so` — a
host-toolchain build from the size experiment (384,640 bytes, `7389f84b…`) —
not the Docker verifiable build. Same source, different toolchain bytes, so the
on-chain program was not reproducible from the repo. Caught when
`anchor verify` failed post-deploy. Fixed before any initialization: manual
`solana program extend` by 10,240 bytes (the loader's ExtendProgram minimum;
the CLI's auto-extend requested only the 6,336-byte delta and was rejected),
then an in-place upgrade to the verifiable artifact (slot 445592588, signature
`3FY7UyP5…`). Net cost ≈ 0.067 SOL (extend rent + fees); the ~2.44 SOL buffer
fronting returned to the deploy wallet on finalize. No state existed, so
nothing else was affected.

## Roles staged for initialization (not yet executed)

Squads mode: the vault signs `initialize`, `init_rake`, `set_resolver`.

- Admin / rake owner / burn treasury / fee recipient: Squads v4 vault
  `GMF3Qhhs2u8tgHChx1H2rFPGdYSgen6c3abnHJwrNdrD` (settings account
  `AsYgd8T3d4e6RVci6Z7ka34ukqJMABtiRHe6wDBceLMY`; 1-of-1, member
  `7QcfCZ8kBK46q9H2eJYx4dB26CuWEJwRtZ2Pyf5sAqpZ`)
- Founder (50 bps slice): `9eX1dkDL6iSyeDvYjZVz4b4sx9kDjK9CNbbXrtkp2LqJ`
  (USDC ATA `8pYHqtBepZPHxDmqUzug5FfiS6119G7cGEaUrk424hyj` exists)
- Resolver (dedicated hot key, resolve/cancel only):
  `4yWsk3gkSbJa5zdQnndDDGmMB2DPH8U5uJrRqosGhviR`
- Agent treasury owner (distinct from burn owner — one owner, one ATA per mint):
  `5ZLrvgKmGA7PJKyHNMQUSdGfX9D3VVZqsuAvkSENJRdW`
- Burn treasury ATA `GSCewJPcsXJNmacK8QmYVAAQoScdczZGXwRXqvhVo9g9`, agent
  treasury ATA `Ci3vAYB8VugaZMUefyiZxxtrWkAobqU9k5oXRoFzor31` (both created)
- Token mint: mainnet USDC `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`

## Initialization — executed 2026-09-10

The vault executed `initialize` + `init_rake` + `set_resolver` as one Squads
transaction (config creation signature
`4DbLkDwG2wGyD1F3yjNfS5m8emLZitL6PjJx5kwHcg3PkqXFQPmrwVMxYRZWwNy1PodN76NrixGQN1WrwjZQuhL4`).
Post-execution on-chain state, fetched and decoded:

- `config.admin` = vault, `config.resolver` = `4yWsk3…`, `pendingAdmin` = none,
  `feeRecipient` = vault, `tokenMint` = mainnet USDC, `marketCounter` = 0,
  `paused` = false.
- `rake.owner` = vault, `founder` = `9eX1d…`, splits 500/300/100/50,
  burn/agent treasuries as staged above.

## Still open at report time

- Mainnet smoke market (tiny real USDC) before any authority handoff.
- Upgrade-authority handoff decision (multisig vs freeze) after testing.
