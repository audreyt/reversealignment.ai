# reversealignment.ai

The coalition site for Reverse Alignment. This repo builds the English apex at
`reversealignment.ai`, the Japanese apex at `reversealignment.jp`, the Taiwanese
Mandarin multi-locale host at `reversealignment.tw`, and the Cloudflare Worker
behind the directory and the join flow.

The member directory is not in this repository. It is served live from Cloudflare
D1 at `https://join.reversealignment.tw/api/members`, and nothing committed here
contains a member's name or address.

Build and contribution notes for coding agents are in [AGENTS.md](AGENTS.md).

---

The domain is registered to **Audrey Tang** personally, transferred on
7 August 2026 from Pathos Labs at their own suggestion, on the coalition's
shared thread. DNS, Workers, D1 and R2 are in her Cloudflare account.

## What is stored

- **Public**, shown in the directory: name, role, affiliation, sector, and an
  optional portrait.
- **Private**, never rendered anywhere: the email address Cloudflare Access
  verified when you joined.
- **Hashed only**: IP address and user agent.

Nothing else. Portraits are halftone-screened in your own browser, and only the
screened image is uploaded — the original never leaves your device.

## Retention

The verified address is kept only while your entry is listed.

## Correction and removal

Any member can edit or delete their own entry at
<https://reversealignment.ai/join/manage/>, authenticated by the same one-time
code used to join. Deleting the entry deletes the stored address in the same
operation.

If you have lost access to the address you joined with, write to
<hello@reversealignment.ai>.

## No onward use

Membership data is not sold, not shared with another organisation, and not used
for any electoral purpose in any jurisdiction.

## If the holder is unavailable

The directory is public at <https://join.reversealignment.tw/api/members> and the
full site source is public at <https://github.com/audreyt/reversealignment.ai>.
Anyone can fork it and stand the coalition's directory back up in another domain.

## Change of circumstance

If Audrey takes a role that conflicts with holding this data, this page will say
so and name what changed.

---

Last reviewed: 2026-08-12
