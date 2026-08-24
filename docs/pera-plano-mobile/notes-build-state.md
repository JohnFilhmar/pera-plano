# Build state — PeraPlano Mobile UI.dc.html
Done (light only): cover, 00 component sheet, onboarding 1–6.
Next: onb7 income (kinsenas segmented + amount), onb8 first limit (₱ vs % + live preview "₱10,000/mo ≈ ₱333/day"), onb9 done/confetti → close section 01. Then sections: 02 Home (hero 4 states + Plus sparkline, limit bars, bills strip, alerts, interrupted banner, paused pill) · 03 Transactions (ledger, review queue + empty, detail w/ notification text + 30d expiry, manual entry numpad) · 04 Wallets (grid+total+mismatch, detail w/ matcher chips, create/edit w/ GCash-vs-GSave split + archive, cash reconciliation sheet, 4th-wallet Plus cap) · 05 Plan (limits list/create/breach; goals cards/create + payday sheet PLUS; loans I-owe/owed-to-me/detail w/ amortization PLUS/add utang 5-6; bills list/detail/create due-rules) · 06 More (list, reports donut+bars+trend + CSV PLUS, subscriptions PLUS ₱1,548/mo, settings, privacy center, listener health, parser diagnostics, about/tier Free-vs-Plus table ₱XX placeholders) · 07 System (4 Android notification cards, 5 empty states, error/loading, shared Plus sheet, Soon full-screen "coming in an update").

## Mechanics
- Every artifact wrapped: <!--P:id-->…<!--/P:id--><!--D:id-->. Dark twin = copy of P block with var-block swapped, then replaces <!--D:id-->.
- Copy swaps: " — Light\"" → " — Dark\"" and ">Light<" → ">Dark<".
- VARBLOCK_LIGHT: --bg:#F7FAF7;--sf:#FFFFFF;--mint:#DCFCE7;--tx:#10201A;--tx2:#5B6E64;--gr:#15803D;--ongr:#FFFFFF;--dg:#DC2626;--wn:#D97706;--ln:#E3EBE5;--chip:#EDF3EE;--shd:0 1px 3px rgba(16,32,26,0.07)
- VARBLOCK_DARK: --bg:#0B1210;--sf:#111A16;--mint:#14261C;--tx:#E8F0EC;--tx2:#9BB0A6;--gr:#22C55E;--ongr:#06130C;--dg:#F87171;--wn:#FBBF24;--ln:#22302A;--chip:#18231E;--shd:0 0 0 1px rgba(255,255,255,0.04)
- Dark-gen run_script (LAST step): read file, regex /<!--P:([\w-]+)-->([\s\S]*?)<!--\/P:\1-->/g, build twin, replaceText each <!--D:id-->. Also verify icons: lucide createIcons in logic already handles.
- Phone skeleton: width:360, height:740 (taller ok for boards), statusbar 12:30 + wifi/signal/battery-full icons; tab screens get tab bar from component sheet (active tab varies, Transactions badge 3).
- Screen append pattern: anchor on `<!--/P:prevId--><!--D:prevId-->\n  </div>` and insert new P block before `  </div>`.
- New sections: append at template end (c_find:""), same header pattern (mono number badge + name + note), inner `<div style="display:flex;flex-wrap:wrap;gap:32px;align-items:flex-start">`.
- Soon treatment: filter:grayscale(1);opacity:.55 + SOON chip. Plus badge: mint bg, lock icon, PLUS.
- Keep each edit small (~<70 lines) — big payloads time out.
