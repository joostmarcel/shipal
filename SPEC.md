# Yavio Package Tracking

## Value Proposition
Track packages through conversation. Target: anyone expecting a delivery who wants quick status updates. Pain: switching between carrier websites and apps to check status.

**Core actions**: Track a package by tracking number.

## Why LLM?
**Conversational win**: "Where's my package RR123456789CN?" = instant tracking vs navigating carrier websites.
**LLM adds**: Interprets tracking status, summarizes delivery timeline, answers follow-up questions.
**What LLM lacks**: Real-time tracking data from carriers (provided by 17Track API).

## UI Overview
**First view**: Loading state while fetching tracking data.
**Result**: Package status card showing current status, latest event, and timeline of tracking events.
**Error**: Clear message if tracking number is invalid or not found.

## Product Context
- **API**: 17Track Real-time Tracking API v2.4 (`POST https://api.17track.net/track/v2.4/gettrackinfo`)
- **Auth**: API key via `17token` header (stored as env var `SEVENTEEN_TRACK_API_KEY`)
- **Constraints**: Max 40 tracking numbers per request, 3 req/s rate limit

## UX Flows

Track a package:
1. User provides tracking number in conversation
2. LLM invokes track-package widget with tracking number
3. Widget displays status card with timeline

## Tools and Widgets

**Widget: track-package**
- **Input**: `{ number: string, carrier?: number }`
- **Output**: `{ status, latestEvent, events[], carrier, trackingNumber }`
- **Views**: Status card with event timeline
- **Behavior**: Displays current delivery status, latest event, and full tracking history
