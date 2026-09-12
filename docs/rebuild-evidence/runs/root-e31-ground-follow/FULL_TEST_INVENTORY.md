# Current full-test inventory

Root reran npm test after E31: the script suite has 653 tests, 637 pass / 16 fail, no skips. Because npm test uses &&, its later app-data/auth/game suites did not run through this command. Separately executed current game224/224 and QA455/455 are valid; never describe npm test as passing. Full output: full-test-inventory.log.

The same 16 failures remain, with current evidence rather than old331-test counts:

- Four missing template-authoring docs: brand-check three assertions require .grok/skills/og/SKILL.md and AGENTS.md, write-atomic one requires its references directory. These are absent from this game checkout. Class C template-bundle contract, not gameplay; do not invent skill policy text to make them pass or silently skip. Preserve in an explicit template suite if separating gates.
- Four app-env assertions: check-auth-invariant once and with-app-env three times assume the reusable starter ships VITE_AUTH_ENABLED=false. Current checkout does not provide that assumed template file. Parsing/merging/override behavior has separate passing fixture cases. Class B/D fixture/default expectation coupling: add an explicit isolated template workspace and run the real wrapper from that fixture, without changing actual game auth configuration to satisfy tests.
- Eight PWA assertions: title fallback/escaping/head-stream cases read Aetherwake site identity from the real cwd, while image-placeholder cases see the real public/og.jpg and correctly prefer it. Class B fixture isolation: run no-site/no-card cases with explicit empty cwd, retain custom-site/custom-card tests separately, preserve exact title escaping and image assertions. Do not replace expected generic output with hardcoded Aetherwake.

This is a diagnosis, not implementation or a passing release gate. T1/T2 remain for root to repair fixtures, explicitly separate the unavailable template-bundle contracts, and run every relevant suite with an aggregate nonzero result if any required suite fails.
