import { GoogleGenAI, Type } from '@google/genai';
import { z } from 'zod';
import type {
  BillingFrequency,
  ExtractedConsentFields,
  MandateStatus,
  VerificationEngineOutput,
} from '../../shared/types.ts';

const MODEL_NAME = 'gemini-4-hydrogen';

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const ExtractionSchema = z.object({
  customerName: z.string().nullable().optional(),
  customerId: z.string().nullable().optional(),
  merchantName: z.string().nullable().optional(),
  merchantId: z.string().nullable().optional(),
  mandateCode: z.string().nullable().optional(),
  authorizedAmount: z.number().positive().nullable().optional(),
  currency: z.string().nullable().optional(),
  billingFrequency: z
    .enum(['DAILY', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY', 'AS_PRESENTED'])
    .nullable()
    .optional(),
  billingSchedule: z.string().nullable().optional(),
  billingDayOfMonth: z.number().int().min(1).max(31).nullable().optional(),
  startDate: z.string().nullable().optional(),
  endDate: z.string().nullable().optional(),
  conditions: z.string().nullable().optional(),
  consentStatus: z
    .enum(['ACTIVE', 'PAUSED', 'REVOKED', 'EXPIRED', 'NEEDS_REVIEW', 'PENDING_CONSENT'])
    .nullable()
    .optional(),
  originalConsentTimestamp: z.string().nullable().optional(),
  confidenceScore: z.number().min(0).max(1).optional(),
  ambiguousFields: z.array(z.string()).optional(),
});

const REQUIRED_FIELDS: Array<keyof ExtractedConsentFields> = [
  'customerName',
  'merchantName',
  'authorizedAmount',
  'billingFrequency',
  'startDate',
];

function finalizeExtraction(
  partial: Partial<ExtractedConsentFields>,
  provider: string
): {
  extracted: ExtractedConsentFields;
  reviewStatus: 'READY' | 'NEEDS_REVIEW';
  provider: string;
} {
  const extracted: ExtractedConsentFields = {
    customerName: partial.customerName ?? null,
    customerId: partial.customerId ?? null,
    merchantName: partial.merchantName ?? null,
    merchantId: partial.merchantId ?? null,
    mandateCode: partial.mandateCode ?? null,
    authorizedAmount:
      typeof partial.authorizedAmount === 'number' && Number.isFinite(partial.authorizedAmount)
        ? partial.authorizedAmount
        : null,
    currency: partial.currency ? partial.currency.toUpperCase() : 'INR',
    billingFrequency: (partial.billingFrequency as BillingFrequency | null) ?? null,
    billingSchedule: partial.billingSchedule ?? null,
    billingDayOfMonth:
      typeof partial.billingDayOfMonth === 'number' ? partial.billingDayOfMonth : null,
    startDate: partial.startDate ?? null,
    endDate: partial.endDate ?? null,
    conditions: partial.conditions ?? null,
    consentStatus: (partial.consentStatus as MandateStatus | null) ?? 'NEEDS_REVIEW',
    originalConsentTimestamp: partial.originalConsentTimestamp ?? partial.startDate ?? null,
    confidenceScore:
      typeof partial.confidenceScore === 'number'
        ? Number(Math.max(0, Math.min(1, partial.confidenceScore)).toFixed(2))
        : 0.5,
    missingFields: [],
    ambiguousFields: partial.ambiguousFields ?? [],
    fieldNotes: partial.fieldNotes ?? {},
  };

  for (const field of REQUIRED_FIELDS) {
    const val = extracted[field];
    if (val === null || val === undefined || val === '') {
      extracted.missingFields.push(field);
    }
  }

  const needsReview =
    extracted.confidenceScore < 0.75 ||
    extracted.missingFields.length > 0 ||
    extracted.ambiguousFields.length > 0 ||
    extracted.consentStatus === 'NEEDS_REVIEW';

  if (needsReview) {
    extracted.consentStatus = 'NEEDS_REVIEW';
  }

  return {
    extracted,
    reviewStatus: needsReview ? 'NEEDS_REVIEW' : 'READY',
    provider,
  };
}

/**
 * Deterministic fallback parser for text-bearing PDFs or text snippets when Gemini API is unavailable.
 */
function deterministicDocumentFallback(rawText: string, fileName: string) {
  const text = rawText || '';
  const amountMatch = text.match(/(?:INR|₹|Rs\.?|USD|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
  const amount = amountMatch ? Number(amountMatch[1].replace(/,/g, '')) : null;
  const currency = /USD|\$/i.test(text) ? 'USD' : 'INR';

  const freqMatch = text.match(/\b(DAILY|WEEKLY|MONTHLY|QUARTERLY|YEARLY|AS_PRESENTED)\b/i);
  const billingFrequency = freqMatch ? (freqMatch[1].toUpperCase() as BillingFrequency) : null;

  const customerMatch = text.match(/Customer(?:\s+Name)?[:\s-]+([A-Za-z][A-Za-z\s.]{2,40})/i);
  const merchantMatch = text.match(/Merchant(?:\s+Name)?[:\s-]+([A-Za-z0-9][A-Za-z0-9\s.&-]{2,50})/i);
  const mandateMatch = text.match(/Mandate\s*(?:ID|Code|Ref)?[:\s#-]+([A-Z0-9-]{4,30})/i);
  const dateMatch = text.match(/\b(202[4-9]-[01]\d-[0-3]\d)\b/);
  const dayMatch = text.match(/Day\s+([1-9]|[12]\d|3[01])\b/i);

  const extractedCount = [customerMatch, merchantMatch, amount, billingFrequency, dateMatch].filter(
    Boolean
  ).length;
  const confidenceScore = Number(Math.min(0.72, 0.25 + extractedCount * 0.1).toFixed(2));

  return finalizeExtraction(
    {
      customerName: customerMatch ? customerMatch[1].trim() : null,
      customerId: null,
      merchantName: merchantMatch ? merchantMatch[1].trim() : null,
      merchantId: null,
      mandateCode: mandateMatch ? mandateMatch[1].trim() : null,
      authorizedAmount: amount,
      currency,
      billingFrequency,
      billingSchedule: dayMatch ? `Day ${dayMatch[1]} of every month` : null,
      billingDayOfMonth: dayMatch ? Number(dayMatch[1]) : null,
      startDate: dateMatch ? `${dateMatch[1]}T00:00:00.000Z` : null,
      endDate: null,
      conditions: `Extracted via deterministic fallback from ${fileName}. Human review required.`,
      consentStatus: 'NEEDS_REVIEW',
      confidenceScore,
      ambiguousFields: extractedCount < 4 ? ['document_scan_quality'] : [],
      fieldNotes: {
        fallback: 'Gemini API was unavailable; deterministic pattern extraction was applied. Verify all fields before saving.',
      },
    },
    'deterministic-fallback'
  );
}

export async function extractConsentDocumentWithAI(params: {
  fileBuffer: Buffer;
  mimeType: string;
  fileName: string;
  rawTextHint?: string;
}): Promise<{
  extracted: ExtractedConsentFields;
  reviewStatus: 'READY' | 'NEEDS_REVIEW';
  provider: string;
  extractionStatus: 'SUCCESS' | 'FALLBACK' | 'FAILED';
  warningMessage: string | null;
}> {
  const ai = getGeminiClient();
  const isPlainText = params.mimeType === 'text/plain';
  const textHint =
    params.rawTextHint ||
    (isPlainText ? params.fileBuffer.toString('utf8').slice(0, 8000) : '');

  const buildUnavailableOutcome = (reason: string) => {
    if (textHint.trim().length > 0) {
      const fb = deterministicDocumentFallback(textHint, params.fileName);
      return {
        ...fb,
        extractionStatus: 'FALLBACK' as const,
        warningMessage: `${reason} Deterministic text-pattern parsing was used as a fallback — review and verify every field before saving.`,
      };
    }

    const empty = finalizeExtraction(
      {
        consentStatus: 'NEEDS_REVIEW',
        confidenceScore: 0,
        ambiguousFields: ['gemini_extraction_unavailable'],
        conditions: null,
        fieldNotes: {
          error: reason,
        },
      },
      'extraction-failed'
    );
    return {
      ...empty,
      extractionStatus: 'FAILED' as const,
      warningMessage: `${reason} Binary document (${params.mimeType}) could not be parsed without Gemini. Please check server Gemini configuration or enter the mandate fields manually.`,
    };
  };

  if (!ai) {
    return buildUnavailableOutcome('Gemini AI service is not configured on the server.');
  }

  try {
    const prompt = `You are a financial compliance document parser for DebitOrigin.
Extract recurring payment mandate / customer authorization fields from the attached consent document.
Rules:
1. Never fabricate values that are not clearly present in the document; return null for any missing field.
2. Normalize billingFrequency to one of: DAILY, WEEKLY, MONTHLY, QUARTERLY, YEARLY, AS_PRESENTED.
3. Normalize dates to ISO-8601 format (YYYY-MM-DD or full ISO timestamp).
4. Set confidenceScore between 0.0 and 1.0 reflecting legibility and completeness.
5. List any unclear, contradictory, or low-legibility fields in ambiguousFields.
6. Set consentStatus to NEEDS_REVIEW if customer signature/OTP/approval evidence is missing or unclear.`;

    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
    if (isPlainText) {
      parts.push({ text: `${prompt}\n\nDocument text:\n${textHint}` });
    } else {
      parts.push({
        inlineData: {
          mimeType: params.mimeType,
          data: params.fileBuffer.toString('base64'),
        },
      });
      parts.push({ text: prompt });
    }

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: { parts },
      config: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            customerName: { type: Type.STRING, nullable: true },
            customerId: { type: Type.STRING, nullable: true },
            merchantName: { type: Type.STRING, nullable: true },
            merchantId: { type: Type.STRING, nullable: true },
            mandateCode: { type: Type.STRING, nullable: true },
            authorizedAmount: { type: Type.NUMBER, nullable: true },
            currency: { type: Type.STRING, nullable: true },
            billingFrequency: { type: Type.STRING, nullable: true },
            billingSchedule: { type: Type.STRING, nullable: true },
            billingDayOfMonth: { type: Type.INTEGER, nullable: true },
            startDate: { type: Type.STRING, nullable: true },
            endDate: { type: Type.STRING, nullable: true },
            conditions: { type: Type.STRING, nullable: true },
            consentStatus: { type: Type.STRING, nullable: true },
            originalConsentTimestamp: { type: Type.STRING, nullable: true },
            confidenceScore: { type: Type.NUMBER },
            ambiguousFields: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
          },
        },
      },
    });

    const rawJson = (response.text ?? '{}').trim();
    const parsedRaw = JSON.parse(rawJson) as Record<string, unknown>;

    // Normalize minor casing/numeric formatting variations before strict Zod validation
    const normalized: Record<string, unknown> = { ...parsedRaw };
    if (typeof normalized.billingFrequency === 'string') {
      const upper = normalized.billingFrequency.trim().toUpperCase().replace(/\s+/g, '_');
      normalized.billingFrequency = [
        'DAILY',
        'WEEKLY',
        'MONTHLY',
        'QUARTERLY',
        'YEARLY',
        'AS_PRESENTED',
      ].includes(upper)
        ? upper
        : null;
    }
    if (typeof normalized.consentStatus === 'string') {
      const upper = normalized.consentStatus.trim().toUpperCase().replace(/\s+/g, '_');
      normalized.consentStatus = [
        'ACTIVE',
        'PAUSED',
        'REVOKED',
        'EXPIRED',
        'NEEDS_REVIEW',
        'PENDING_CONSENT',
      ].includes(upper)
        ? upper
        : null;
    }
    if (typeof normalized.authorizedAmount === 'string') {
      const n = Number(normalized.authorizedAmount.replace(/[^0-9.]/g, ''));
      normalized.authorizedAmount = Number.isFinite(n) && n > 0 ? n : null;
    }

    const validated = ExtractionSchema.safeParse(normalized);

    if (!validated.success) {
      return buildUnavailableOutcome(
        'Gemini returned an unexpected schema structure that did not pass compliance validation.'
      );
    }

    return {
      ...finalizeExtraction(validated.data as Partial<ExtractedConsentFields>, MODEL_NAME),
      extractionStatus: 'SUCCESS',
      warningMessage: null,
    };
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown upstream error';
    console.error('Gemini document extraction failed:', errMsg);
    return buildUnavailableOutcome(`Gemini extraction request failed (${errMsg.slice(0, 140)}).`);
  }
}

/**
 * Generates an evidence-backed forensic explanation strictly from deterministic verification output.
 * Prohibits inventing events, fabricating consent, changing outcomes, or asserting unconfirmed fraud.
 */
export async function generateForensicExplanation(
  verification: VerificationEngineOutput,
  mandateCode: string,
  merchantName: string
): Promise<{ explanation: string; provider: string }> {
  const ai = getGeminiClient();
  if (!ai) {
    return {
      explanation: verification.deterministicExplanation,
      provider: 'deterministic-fallback',
    };
  }

  try {
    const structuredEvidence = {
      mandateCode,
      merchantName,
      verificationStatus: verification.status,
      severity: verification.severity,
      asOfTimestamp: verification.replay.asOfTimestamp,
      originalCustomerConsent: verification.replay.originalConsent,
      reconstructedAuthorizationAtAttempt: verification.replay.reconstructedAuthorization,
      merchantSideRecordAtAttempt: verification.replay.merchantSideRecord,
      attemptedPayment: {
        amount: verification.attemptedAmount,
        currency: verification.currency,
        amountDelta: verification.amountDelta,
      },
      approvedModifications: verification.replay.approvedModifications,
      unsupportedModifications: verification.replay.unsupportedModifications,
      ambiguousOrMissingEvidenceEvents: verification.replay.ambiguousOrMissingEvidenceEvents,
      violations: verification.violations.map((v) => ({
        type: v.violationType,
        severity: v.severity,
        classification: v.classification,
        relevantEventIds: v.relevantEventIds,
        explanation: v.explanation,
      })),
    };

    const response = await ai.models.generateContent({
      model: MODEL_NAME,
      contents: `Explain this recurring payment verification decision clearly for a risk analyst and compliance reviewer based strictly on the supplied JSON evidence:\n${JSON.stringify(structuredEvidence, null, 2)}`,
      config: {
        systemInstruction: `You are a forensic payment risk explainer for DebitOrigin.
Write a concise 3-4 sentence plain-English explanation grounded strictly in the supplied JSON evidence.
STRICT CONSTRAINTS:
- NEVER invent events, dates, amounts, or consent records not present in the JSON.
- NEVER change or contradict the verificationStatus (${verification.status}).
- NEVER authorize a payment.
- If classification is INCOMPLETE_EVIDENCE or status is NEEDS_REVIEW, explicitly note that evidence is incomplete/ambiguous and do NOT label it confirmed fraud.
- Cite exact amounts, dates, and event UIDs when present in the JSON.`,
      },
    });

    const text = response.text?.trim();
    if (!text) {
      return {
        explanation: verification.deterministicExplanation,
        provider: 'deterministic-fallback',
      };
    }

    return {
      explanation: text,
      provider: MODEL_NAME,
    };
  } catch (error) {
    console.error('Gemini forensic explanation failed, using deterministic fallback:', error);
    return {
      explanation: verification.deterministicExplanation,
      provider: 'deterministic-fallback',
    };
  }
}
