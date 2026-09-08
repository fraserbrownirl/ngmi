#!/usr/bin/env bash
# Six-pattern mechanical gate for programs/fomo-pnl (Trail of Bits scanner
# skill). Same script locally and in CI — no forks. Exit 1 on any hit.
set -uo pipefail
cd "$(dirname "$0")/.."

fail=0

# Patterns that must not appear in program source at all.
check_absent() {
  local label="$1" pattern="$2"
  if rg -n "$pattern" programs/; then
    echo "six-pattern gate FAILED: $label"
    fail=1
  fi
}

# 1. Arbitrary CPI — all CPIs go through Anchor `Program<'info, Token>`.
check_absent "raw CPI (invoke/invoke_signed)" 'invoke\(|invoke_signed\('
# 2. Improper PDA validation — PDAs come from Anchor seeds constraints only.
check_absent "manual PDA derivation" 'find_program_address|create_program_address'
# 5/6. Sysvar spoofing + instruction introspection — not used anywhere.
check_absent "instruction introspection" 'load_instruction_at|load_current_index|get_instruction_relative'
check_absent "sysvar passed as account" 'Sysvar<'

# 3. Missing ownership check — manual deserialization is allowed only inside
# resolve_market.rs (is_usdc_ata), and only with the owner check intact.
if rg -n 'try_from_slice|try_deserialize' programs/ | rg -v 'instructions/resolve_market\.rs'; then
  echo "six-pattern gate FAILED: manual deserialization outside resolve_market.rs"
  fail=1
fi
if ! rg -q '\*info\.owner != anchor_spl::token::ID' programs/fomo-pnl/src/instructions/resolve_market.rs; then
  echo "six-pattern gate FAILED: is_usdc_ata lost its owner-before-deserialize check"
  fail=1
fi

# 4. Missing signer/ownership surface — UncheckedAccount is limited to the two
# optional recipient ATAs in resolve_market.
if rg -n 'UncheckedAccount' programs/ | rg -v 'resolve_market\.rs'; then
  echo "six-pattern gate FAILED: UncheckedAccount outside resolve_market.rs"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "six-pattern scan clean"
fi
exit "$fail"
