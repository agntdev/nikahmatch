# Nikaḥ Matchmaker — Bot specification

**Archetype:** community

**Voice:** warm and encouraging — write every user-facing message, button label, error, and empty state in this voice.

A Telegram matchmaking bot for Muslim users to create marriage-focused (nikaḥ) profiles, browse and match by configurable criteria, and enable secure admin moderation and notifications. Profiles, matches and reports are persisted until user deletion; photos and contact details are protected until mutual consent.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- Muslim singles seeking marriage (nikaḥ)
- Family members assisting relatives
- Community moderators / admins

## Success criteria

- Users can complete a profile via onboarding wizard and see a profile preview
- Users can browse profiles with Next/Profile/Like/Skip buttons and set quick filters
- Mutual Likes create a Match record and send notifications to both parties
- Admin receives notifications for new profiles and reports in ADMIN_CHAT_ID and can remove profiles
- Users can request account/data deletion and records are removed from persistent storage

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open the main menu and start onboarding or resume
  - outputs: Main menu (Create profile, Browse, My profile, Filters, Help)
- **Create profile** (button, actor: user, callback: profile:create) — Start the profile creation wizard (language + rules + fields)
  - inputs: language choice, consent flag, display name, age, gender, city/region, marital status, sect/school (optional), practice level (choice), education, occupation, short bio, photos (optional)
  - outputs: Profile draft saved, Profile preview message with Confirm/Edit buttons, Admin notification (new profile) sent to ADMIN_CHAT_ID
- **Browse profiles** (button, actor: user, callback: browse:start) — Open swipe-like browsing session with quick actions
  - inputs: active search filters (current user's defaults or explicit filters)
  - outputs: Profile card message with Next, Like, View profile, Report buttons, Match notification when mutual Like occurs
- **My profile** (button, actor: user, callback: profile:view) — View or edit your profile, privacy settings, and delete account
  - outputs: Profile summary, Edit field buttons, Privacy toggles (hide name, hide photos), Delete account request flow
- **Filters** (button, actor: user, callback: browse:filters) — Set quick search criteria (gender, age range, region radius, practice level)
  - inputs: gender, age range, location radius or region, sect/school (optional), practice level, education, marital status
  - outputs: Active filter summary, Filtered browsing session
- **Report profile** (button, actor: user, callback: profile:report) — Report a profile for admin review (appears on each profile card)
  - inputs: report reason (fixed set), optional text details
  - outputs: Report stored, Admin notification (report) to ADMIN_CHAT_ID, Acknowledgement to reporter

## Flows

### Onboarding and profile creation
_Trigger:_ /start or profile:create button

1. Ask language (RU/EN) and save preference
2. Show short rules and request consent (nikaḥ-only, respectful)
3. Launch profile wizard asking required fields one-by-one (use ForceReply for free-text fields and inline choices for enumerations)
4. Validate age (>=18) and required fields
5. Upload photos step (optional); warn photos hidden until profile complete
6. Show profile preview with Edit/Confirm buttons
7. On confirm, save profile, mark profile complete, notify ADMIN_CHAT_ID

_Data touched:_ UserProfile, Photos, Analytics

### Browsing (swipe-like)
_Trigger:_ browse:start button

1. Load profiles matching default filters (gender, age range, region preferred)
2. Show one profile card with Name (or display label), age, city, practice level, short bio and photos per privacy rules
3. Offer inline buttons: Like, Next, View profile, Report
4. Record actions (viewed/liked/skipped) to MatchRecord
5. If Like and the other user previously liked back -> create Match and notify both with safe contact instructions

_Data touched:_ UserProfile, MatchRecord, Analytics

### Mutual match and contact consent
_Trigger:_ both users Like each other

1. Create MatchRecord with timestamps and consent flags
2. Send match notification to both users with steps to share contact (phone/email) safely
3. If either has privacy settings hiding full name/phone, remind users to share explicitly after mutual consent

_Data touched:_ MatchRecord, UserProfile

### Reporting & moderation
_Trigger:_ profile:report button or admin command

1. Store report item with reporter id, reason, timestamp, target profile
2. Notify ADMIN_CHAT_ID with report summary and action buttons (Review, Remove, Dismiss)
3. Admin taps Review -> view profile and full report thread
4. Admin chooses action: Remove profile (mark deleted/hidden), Warn user, or Dismiss report
5. If removed, send user notification and log action in Analytics

_Data touched:_ Reports, UserProfile, Analytics

### Admin controls and inbox
_Trigger:_ admin chat commands or callback buttons (admin only)

1. Admin can call /admin_reports to list recent reports and /admin_new to list recent signups
2. Selecting an item opens details and action buttons (Remove, Message user, Dismiss)
3. Owner actions are recorded and require OWNER_CHAT_ID authorization

_Data touched:_ Reports, UserProfile

### Account deletion
_Trigger:_ My profile -> Delete account button

1. Confirm deletion with explicit consent and passwordless confirmation
2. On confirm, remove user profile, photos, matches and reports (or anonymize per policy), and send confirmation to user and ADMIN_CHAT_ID
3. Log deletion in Analytics

_Data touched:_ UserProfile, Photos, MatchRecord, Reports, Analytics

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Where new-profile and report notifications are sent (owner or moderator chat id)
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **UserProfile** _(retention: persistent)_ — Primary profile for matchmaking
  - fields: user_id (telegram), display_name, full_name (optional, hidden by default), age, gender, city_region, marital_status, sect_school (optional), practice_level (enumeration), education, occupation, short_bio, privacy_settings (hide_name,bool; hide_photos,bool; contact_pref), profile_completed_flag, created_at, updated_at
- **Photos** _(retention: persistent)_ — User-uploaded profile photos; visibility controlled by privacy_settings
  - fields: photo_id (storage reference), user_id, uploaded_at, visibility (hidden/visible), moderation_status (ok/removed/pending)
- **MatchRecord** _(retention: persistent)_ — Records of views, likes, matches, contact consents
  - fields: match_id, user_a_id, user_b_id, a_liked_at, b_liked_at, matched_at, contact_shared_flag, contact_shared_timestamp
- **Reports** _(retention: persistent)_ — User-submitted reports for moderation
  - fields: report_id, reporter_user_id, target_user_id, reason (enumeration), details_text, created_at, status (open/resolved/dismissed), admin_action_log
- **Analytics** _(retention: persistent)_ — Basic counts and event logs for admin dashboards and safety monitoring
  - fields: event_type, user_id, target_id, timestamp, metadata

## Integrations

- **Telegram** (required) — Bot API messaging, inline keyboards, callback queries, ForceReply dialogs
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Receive admin notifications (new profile, reports, removals) at ADMIN_CHAT_ID
- List recent signups and reports via admin commands
- Remove or reinstate profiles
- Toggle (enable/disable) monetization feature (if owner supplies payment details)
- Request full export or deletion of user data (handled on-platform)

## Notifications

- New profile submitted -> ADMIN_CHAT_ID
- New report submitted -> ADMIN_CHAT_ID
- Mutual match -> both matched users
- Profile removed by admin -> targeted user and ADMIN_CHAT_ID
- Account deletion confirmation -> requesting user and ADMIN_CHAT_ID

## Permissions & privacy

- Photos and full name are hidden by default until profile is marked complete or user toggles visibility
- Phone/email are never shared automatically; must be sent explicitly in chat after mutual consent
- Reports and moderation actions visible only to admins and logged in Reports entity
- Data retained until user requests deletion (owner must provide deletion workflow); deletion anonymizes or removes all personal fields and media
- Bot must enforce age >= 18 during onboarding and block underage accounts

## Edge cases

- Duplicate accounts for same person — provide owner/admin tools to merge or remove duplicates
- Incomplete profiles appear in browsing only after required fields confirmed; incomplete drafts not shown
- Missing ADMIN_CHAT_ID — bot should run in limited mode but must prompt owner to provide ADMIN_CHAT_ID; admin actions disabled until provided
- Malicious or explicit photos — moderation flagging and admin removal; auto-hide photos pending review
- Conflicting reports or mass-report attacks — require manual admin review and rate-limit reporters
- Storage failures when saving photos or profiles — surface retry and preserve draft
- Language mismatch — user default RU with English fallback; content may show mixed language until user sets preference

## Required tests

- Onboarding acceptance test: language, consent, complete profile saved and admin notified
- Browse acceptance test: filter applied, show profiles, Next/Like/Skip actions recorded
- Mutual like acceptance test: second like creates MatchRecord and both users receive match notification
- Report & moderation test: reporter can submit report, admin receives it and can remove profile; removal hides profile from browsing
- Privacy test: photos and full name remain hidden until privacy toggles/consent conditions met
- Deletion test: user requests deletion and system removes/anonymizes profile, photos, matches and confirms to user/admin

## Assumptions

- Users are adults (>=18); bot enforces age validation during onboarding
- Owner prefers Russian as primary language with English fallback
- Default matching uses exact gender + age range + region preference; sect/school and practice level are optional filters
- Payments are disabled by default; enabling monetization requires owner-supplied payment/provider details
- Email/phone exchanges happen manually between matched users in chat and are not stored unless the user pastes them
