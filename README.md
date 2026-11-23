<<<<<<< HEAD
<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://ai.google.dev/static/site-assets/images/share-ais-513315318.png" />
</div>

# Run and deploy your AI Studio app

This contains everything you need to run your app locally.

View your app in AI Studio: https://ai.studio/apps/7704e9f8-b42f-4cee-83d5-fc74bffe12d3

## Run Locally

**Prerequisites:**  Node.js


1. Install dependencies:
   `npm install`
2. Set the `GEMINI_API_KEY` in [.env.local](.env.local) to your Gemini API key
3. Run the app:
   `npm run dev`
=======
# 💳 DebitOrigin
### AI-Powered Recurring Payment Consent Verification Platform

> **Every debit must trace back to valid customer consent.**

DebitOrigin is an AI-powered platform that verifies whether recurring payment attempts are supported by the customer's original authorization and subsequent approved changes.

Merchants may sometimes modify subscription amounts, billing frequencies, or other mandate details without obtaining fresh customer consent. Even when a mandate appears active, a payment attempt may no longer match what the customer actually authorized.

DebitOrigin addresses this problem by reconstructing the customer's authorization history, detecting unauthorized changes, and identifying recurring debits that require verification or investigation.

---

## 🚨 The Problem

Consider this scenario:

1. A customer authorizes a recurring payment of **₹499 per month**.
2. The merchant successfully processes the first payment.
3. Later, the merchant changes the subscription amount to **₹799** without obtaining the customer's approval.
4. The mandate still appears ACTIVE.
5. The merchant attempts to debit ₹799.

A system that checks only the current mandate status may consider this payment valid.

**But did the customer ever authorize ₹799?**

DebitOrigin investigates exactly this kind of situation.

---

## 🔍 Signature Feature: Consent Drift Replay

Consent Drift Replay is the core feature that differentiates DebitOrigin.

Instead of relying only on the latest mandate status, it replays the complete history of consent and mandate events to reconstruct exactly what the customer had authorized at a particular point in time.

It compares:

- Original customer-approved consent.
- Subsequent customer-approved modifications.
- Merchant-side mandate updates.
- The actual payment attempt.

If a merchant changes the amount without customer approval, DebitOrigin identifies the mismatch and flags the payment attempt.

> **The key idea:** A change in merchant records does not automatically mean a change in customer consent.

---

## ⚡ Key Features

### 1. 🤖 AI-Powered Consent Extraction
- Extract mandate details from uploaded consent documents.
- Identify merchant, customer, amount, frequency, and validity period.
- Generate structured consent data using Gemini.
- Highlight missing or ambiguous information.

### 2. 📜 Mandate Event History
- Maintain a chronological history of mandate events.
- Track consent creation, modifications, pauses, resumptions, revocations, and expiry.
- Preserve historical events for accurate verification.

### 3. ⏳ Historical Authorization Reconstruction
- Replay mandate events to determine authorization at any given timestamp.
- Compare original consent with subsequent approved changes.
- Detect unsupported merchant-side modifications.

### 4. 🛡️ Consent Drift Detection

Identify suspicious payment attempts involving:
- Unauthorized amount increases.
- Changes in billing frequency.
- Merchant mismatches.
- Payments after mandate revocation or expiry.
- Payments during a paused period.
- Duplicate billing attempts.
- Missing or insufficient authorization evidence.

### 5. ⚖️ Deterministic Payment Verification

Every payment attempt receives an outcome:

| Outcome | Meaning |
|---|---|
| 🟢 VERIFIED | Payment matches valid authorization evidence |
| 🟠 FLAGGED | A potential authorization violation is detected |
| 🔴 BLOCKED | A defined authorization rule is violated |
| 🟡 NEEDS_REVIEW | Available evidence is incomplete or ambiguous |

AI assists with extracting and explaining evidence, while the verification engine makes decisions using deterministic rules.

### 6. 🧠 AI-Powered Forensic Explanations
- Explain why a payment attempt was flagged.
- Highlight differences between authorized and attempted amounts.
- Reference relevant mandate events.
- Generate evidence-based investigation summaries.

### 7. 📊 Risk Dashboard
- Monitor recurring payment attempts.
- View verified, flagged, blocked, and review-required transactions.
- Track suspicious payment exposure.
- Explore violation categories and recent investigations.

### 8. 🔎 Investigation and Audit Management
- Investigate individual payment attempts.
- Review historical authorization timelines.
- Add investigation notes and record human decisions.
- Maintain audit logs.
- Generate evidence reports.

---

## 🛠️ Technology Stack

| Component | Technology |
|---|---|
| Frontend | React, Vite, TypeScript |
| Styling | Tailwind CSS, shadcn/ui |
| Backend | Python, FastAPI |
| Database | PostgreSQL / SQLite |
| AI Integration | Google Gemini API |
| Data Processing | Pandas, NumPy |
| Machine Learning | Scikit-learn |
| Visualizations | Recharts |
| Testing | Pytest |

*The technology stack may evolve during development.*

---

## 🏗️ System Architecture

```text
             Consent Documents
                     |
                     v
           AI Consent Extraction
                     |
                     v
             Structured Consent
                     |
                     v
              Mandate Database
                     |
             Historical Events
                     |
                     v
          Consent Drift Replay
                     |
                     v
          Authorization Engine
                     |
                     v
           Payment Verification
                     |
          +----------+----------+
          |          |          |
          v          v          v
       VERIFIED   FLAGGED   NEEDS_REVIEW
          |
          v
     Risk Dashboard
          |
          v
   Investigation & Audit
```

---

## 📈 Project Evaluation

DebitOrigin is designed to be evaluated using synthetic mandate histories and payment attempts covering both legitimate and suspicious scenarios.

Evaluation metrics include:

- Precision
- Recall
- F1-score
- False-positive rate
- Confusion matrix
- Suspicious payment exposure identified

The goal is to measure how effectively the platform identifies payment attempts that do not match valid customer authorization.

---

## 🔐 Security and Design Principles

- Use synthetic data for development and demonstration.
- Preserve historical mandate events.
- Never treat merchant-side updates as customer-approved consent.
- Keep authorization decisions deterministic and explainable.
- Distinguish confirmed violations from incomplete evidence.
- Maintain audit trails for verification and investigation actions.
- No live payment debits are executed by this platform.

---

## 🏆 Project Information

| Detail | Information |
|---|---|
| **Project** | DebitOrigin |
| **Track** | AI Risk Manager |
| **Event** | Razorpay AI Buildathon 2026 |
| **Development** | Independent / Solo Project |

DebitOrigin aims to make recurring payments more transparent and trustworthy by ensuring that every debit can be traced back to valid customer authorization.

> **Every debit has a history. DebitOrigin makes sure that history adds up.** 💳
>>>>>>> 332157d6c1ac523e7e9b867f0fdaa94a7cc4924e
