# SupplyScout — Autonomous Supplier Discovery & RFQ Agent

## Overview
A full-stack hackathon MVP demonstrating autonomous AI web agents that discover, qualify, score, and contact real manufacturing suppliers. Built for the TinyFish Web Agent Hackathon.

## Tech Stack
- **Frontend**: React + Wouter routing + TanStack Query + shadcn/ui + Framer Motion
- **Backend**: Express.js + TypeScript
- **AI**: Anthropic Claude (via Replit AI Integrations) for capability extraction & summarization
- **Web Agents**: TinyFish API (real browser automation for web navigation, form filling, data extraction)
- **Database**: PostgreSQL (Replit built-in) + Drizzle ORM

## Key Features
1. **Landing Page** — Hero with "Start Sourcing" CTA
2. **Input Form** — Product spec, certifications, MOQ, location, quantity
3. **Live Agent Dashboard** — Real-time terminal log view as agents work
4. **Results Table** — Ranked suppliers with scores, certifications, MOQ, RFQ status + CSV export

## Multi-Agent Pipeline (server/routes.ts)
1. **Discovery Agent** — TinyFish navigates ThomasNet & GlobalSources, extracts supplier profile URLs
2. **Qualification Agent** — TinyFish visits each supplier website, extracts capabilities/certs/MOQ (Claude parses raw text to JSON)
3. **Scoring Agent** — Rules-based scoring: +3 cert match, +2 location match, +2 MOQ match, +1 capability match
4. **RFQ Agent** — TinyFish finds and fills contact/RFQ forms on qualifying supplier sites
5. **Synthesis** — Claude summarizes top findings for procurement manager

## TinyFish Integration (server/tinyfish.ts)
- `runAgent(url, goal, options)` — Core function wrapping TinyFish SSE streaming API
- `extractSupplierInfo(url, spec)` — Navigate supplier site, extract structured JSON
- `submitRFQForm(url, rfqData)` — Find and fill RFQ/contact forms autonomously
- API base: `https://agent.tinyfish.ai/v1/automation/run-sse`
- Supports stealth mode and proxy configuration

## Database Schema
- **jobs** — Sourcing requests (spec, certifications, maxMoq, preferredLocation, quantity, status)
- **logs** — Real-time agent activity logs per job
- **suppliers** — Discovered/qualified suppliers with scores (name, location, certifications, capabilities, moq, score, rfqSent, url, confidenceScore)

## Environment Variables
- `DATABASE_URL` — PostgreSQL connection (auto-provided by Replit)
- `AI_INTEGRATIONS_ANTHROPIC_API_KEY` — Claude API via Replit AI Integrations
- `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` — Claude base URL
- `TINYFISH_API_KEY` — TinyFish web agent API key

## Seed Data
Job #4 contains a verified real-manufacturer dataset for "ABS injection-molded electronic enclosures":
- Polycase (Avon Lake, OH) — ISO 9001:2015, IP65, MOQ 250, Score 7/8
- Hammond Manufacturing (Guelph, ON) — ISO 9001:2015, CE, MOQ 500, Score 6/8
- Bud Industries (Willoughby, OH) — ISO 9001, IP65, MOQ 500, Score 6/8
- Serpac (Rancho Santa Margarita, CA) — UL 94V-0, MOQ 1000, Score 5/8
- New Age Enclosures (San Diego, CA) — ISO 9001:2015, MOQ 100, Score 5/8
- OKW Enclosures (UK/NJ) — ISO 9001:2015, CE, MOQ 500, Score 4/8
