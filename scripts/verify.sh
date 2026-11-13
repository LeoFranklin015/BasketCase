#!/usr/bin/env bash
# Run every check a judge or CI would run, in order, and print a PASS/FAIL summary with counts.
# Sends no transaction and signs nothing.
#
#   ./scripts/verify.sh                   offline: Rust tests, simulator check, unit tests, typecheck, Playwright smoke
#   ./scripts/verify.sh --live            also read the testnet contracts over RPC with curl (read-only)
#   ./scripts/verify.sh --mainnet-check   also run the read-only mainnet readiness check (scripts/src/mainnet-check.ts)
#   ./scripts/verify.sh --live-only       only the on-chain checks (fast; no build)
#
# Needs: Rust (stable), Node 22+, pnpm 10, curl. First run installs JS deps and Playwright's Chromium.
# Env: RPC (default https://rpc.testnet.fastnear.com), FACTORY (default from deployments/testnet.json).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OFFLINE=1 LIVE=0 MAINNET=0
for a in "$@"; do
  case "$a" in
    --live) LIVE=1 ;;
    --live-only) LIVE=1 OFFLINE=0 ;;
    --mainnet-check) MAINNET=1 ;;
    -h | --help) sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a (try --help)" >&2; exit 2 ;;
  esac
done

LOGS="$(mktemp -d "${TMPDIR:-/tmp}/verify.XXXXXX")"
NAMES=() STATES=() DETAILS=()
FAILED=0

record() { NAMES+=("$1"); STATES+=("$2"); DETAILS+=("$3"); [ "$2" = FAIL ] && FAILED=1 || true; }

# step <name> <dir> <count-kind> <command...>: runs the command in <dir>, logs its output, records PASS/FAIL.
step() {
  local name="$1" dir="$2" kind="$3"; shift 3
  local log="$LOGS/$(printf '%s' "$name" | tr -c 'a-zA-Z0-9' '_').log"
  local t0=$SECONDS
  local shown="${dir#"$ROOT"}"; shown="${shown#/}"
  printf '\n== %s\n   (cd %s && %s)\n' "$name" "${shown:-.}" "$*"
  if (cd "$dir" && "$@") >"$log" 2>&1; then
    local n; n="$(count "$kind" "$log")"
    record "$name" PASS "$n ($((SECONDS - t0))s)"
    printf '   PASS  %s\n' "$n"
  else
    record "$name" FAIL "see $log"
    printf '   FAIL  last lines of %s:\n' "$log"
    tail -n 25 "$log" | sed 's/^/   | /'
  fi
}

# Test counts, read from each runner's own summary line.
count() {
  local kind="$1" log="$2"
  case "$kind" in
    cargo) awk '/^test result: ok\./ { n += $4 } END { printf "%d tests passed", n }' "$log" ;;
    vitest) { grep -Eo 'Tests +[0-9]+ passed' "$log" || echo "Tests 0 passed"; } | tail -n 1 | awk '{ printf "%d tests passed", $2 }' ;;
    playwright) { grep -Eo '^ *[0-9]+ passed' "$log" || echo 0; } | tail -n 1 | awk '{ printf "%d tests passed", $1 }' ;;
    sim) tail -n 1 "$log" ;;
    mainnet) printf '%d steps PASS, %d FAIL (only "factory deployed on mainnet" may fail)' "$(grep -c '^PASS' "$log" || true)" "$(grep -c '^FAIL' "$log" || true)" ;;
    *) echo "ok" ;;
  esac
}

if [ "$OFFLINE" = 1 ] || [ "$MAINNET" = 1 ]; then
  if [ ! -d node_modules ] || [ ! -d web/node_modules ]; then
    echo "== installing JS dependencies (pnpm install --frozen-lockfile)"
    pnpm install --frozen-lockfile
  fi
fi

if [ "$OFFLINE" = 1 ]; then
  step "Rust: curve math, coin, factory, mocks, simulator" "$ROOT" cargo cargo test --workspace --release
  if [ -d sim ]; then
    step "Simulator: committed 60-day output matches a fresh run" "$ROOT" sim cargo run -q -p sim --release -- --check
  fi
  step "Unit tests: packages/client" "$ROOT/packages/client" vitest pnpm exec vitest run
  step "Unit tests: scripts" "$ROOT/scripts" vitest pnpm exec vitest run
  step "Unit tests: web" "$ROOT/web" vitest pnpm exec vitest run
  step "Typecheck: client, scripts, web" "$ROOT" plain pnpm -r typecheck
  # Fixture mode: builds the app with built-in sample data and clicks through every page. No chain access.
  # Idempotent: downloads Chromium only if this Playwright version lacks it.
  (cd web && pnpm exec playwright install chromium >/dev/null 2>&1) || echo "   (could not install Chromium; the smoke step will say why)"
  step "Browser smoke tests: web (fixture data, Playwright)" "$ROOT/web" playwright env CI=1 pnpm exec playwright test
fi

if [ "$LIVE" = 1 ]; then
  RPC="${RPC:-https://rpc.testnet.fastnear.com}"
  FACTORY="${FACTORY:-$(node -p "require('./deployments/testnet.json').factory")}"
  printf '\n== On-chain checks (read-only) against %s, factory %s\n' "$RPC" "$FACTORY"

  # rpc <json-params>: one JSON-RPC "query" with curl; backs off and retries when the free RPC rate-limits (-429).
  rpc() {
    local body="{\"jsonrpc\":\"2.0\",\"id\":\"verify\",\"method\":\"query\",\"params\":$1}" out i
    for i in 1 2 3 4 5 6; do
      out="$(curl -sS -m 20 "$RPC" -H 'content-type: application/json' -d "$body" || true)"
      case "$out" in *'"result"'*) printf '%s' "$out"; return 0 ;; esac
      sleep $((i * 3))
    done
    printf '%s' "$out"
    return 1
  }
  # view <account> <method> [args-json]: a contract view call; prints the decoded JSON result.
  view() {
    local args; args="$(printf '%s' "${3:-"{}"}" | base64 | tr -d '\n')"
    rpc "{\"request_type\":\"call_function\",\"finality\":\"final\",\"account_id\":\"$1\",\"method_name\":\"$2\",\"args_base64\":\"$args\"}" |
      node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s);if(!r.result){console.error("RPC error: "+JSON.stringify(r.error??r).slice(0,160));process.exit(1)}process.stdout.write(Buffer.from(r.result.result).toString())})'
  }

  if coins="$(view "$FACTORY" list_coins '{"from":0,"limit":100}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).map(c=>c.account_id).join(" ")))')" && [ -n "$coins" ]; then
    record "Factory lists coins (list_coins)" PASS "$(wc -w <<<"$coins" | tr -d ' ') coins"
    echo "   PASS  coins: $coins"
  else
    record "Factory lists coins (list_coins)" FAIL "no coins read from $FACTORY"
    coins=""
  fi

  keyless=0 keyfail=""
  floors=0 floorfail="" unread=""
  for c in $coins; do
    n="$(rpc "{\"request_type\":\"view_access_key_list\",\"finality\":\"final\",\"account_id\":\"$c\"}" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).result.keys.length))' 2>/dev/null || echo "?")"
    if [ "$n" = 0 ]; then keyless=$((keyless + 1)); else keyfail="$keyfail $c($n)"; fi
    printf '   %s: %s access keys' "$c" "$n"

    # Floor sanity: get_state.floor equals the contract's formula on get_state's own fields, and 0 < floor <= price.
    #   before graduation: floor = 5,000 BU / 1.073B tokens (the curve's lowest price) + surplus / sold
    #   after graduation:  floor = reserve / supply
    state="$(view "$c" get_state 2>"$LOGS/rpc.err" || true)"
    if [ -z "$state" ]; then
      verdict="unread: $(cat "$LOGS/rpc.err")"
      unread="$unread $c"
    elif verdict="$(printf '%s' "$state" | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        const st=JSON.parse(s), E=10n**18n, B=(x)=>BigInt(x);
        const want = st.mode==="index"
          ? (B(st.supply)===0n?0n:B(st.reserve)*E/B(st.supply))
          : (5000n*E*E)/(1073000000n*E) + (B(st.sold)===0n?0n:B(st.surplus)*E/B(st.sold));
        const ok = want===B(st.floor) && B(st.floor)>0n && B(st.floor)<=B(st.price);
        console.log(`${ok?"ok":"BAD"} mode=${st.mode} floor=${Number(st.floor)/1e18} price=${Number(st.price)/1e18} BU/token, formula=${Number(want)/1e18}`);
        process.exitCode = ok?0:1;
      })')"; then
      floors=$((floors + 1))
    else
      floorfail="$floorfail $c"
    fi
    printf ', %s\n' "${verdict:-unread}"
    sleep 0.3
  done
  if [ -n "$coins" ]; then
    total="$(wc -w <<<"$coins" | tr -d ' ')"
    if [ -z "$keyfail" ]; then record "Every coin has zero access keys" PASS "$keyless of $total"; else record "Every coin has zero access keys" FAIL "has keys:$keyfail"; fi
    if [ -n "$floorfail" ]; then record "Floor = contract formula, 0 < floor <= price" FAIL "mismatch:$floorfail"
    elif [ -n "$unread" ]; then record "Floor = contract formula, 0 < floor <= price" FAIL "$floors of $total checked; RPC refused reads for:$unread (rate limit? rerun or set RPC=)"
    else record "Floor = contract formula, 0 < floor <= price" PASS "$floors of $total"; fi
    tomb=0
    for c in $coins; do
      t="$(view "$c" get_tombstones '{"from":0,"limit":100}' | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).length))' 2>/dev/null || echo 0)"
      tomb=$((tomb + t))
    done
    record "Tombstones (assets voted out, get_tombstones)" PASS "$tomb across $total coins"
  fi
fi

if [ "$MAINNET" = 1 ]; then
  # Expected: every step PASS except "factory deployed on mainnet" (nothing is deployed on mainnet yet).
  step "Mainnet readiness (read-only; signs nothing)" "$ROOT/scripts" mainnet pnpm exec tsx src/mainnet-check.ts
  grep -E '^(PASS|FAIL)' "$LOGS"/Mainnet*.log | sed 's/^/   /' || true
fi

printf '\n%s\n' "== Summary"
for i in "${!NAMES[@]}"; do
  printf '%-5s %-56s %s\n' "${STATES[$i]}" "${NAMES[$i]}" "${DETAILS[$i]}"
done
if [ "$FAILED" = 0 ]; then echo "All checks passed. Logs: $LOGS"; else echo "Some checks failed. Logs: $LOGS"; fi
exit "$FAILED"
