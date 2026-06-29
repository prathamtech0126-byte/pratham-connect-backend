import { Response } from "express";
import {
  LeadEditTokenRequest,
} from "../middlewares/leadEditToken.middleware";
import {
  getLeadForSelfEdit,
  updateLeadForSelfEdit,
  LeadSelfEditInput,
} from "../services/leadSelfEdit.service";

function parseSelfEditBody(body: Record<string, unknown>): LeadSelfEditInput {
  const profileRaw = body.profile as Record<string, unknown> | undefined;
  const profile =
    profileRaw && typeof profileRaw === "object"
      ? {
          gender: profileRaw.gender as string | undefined,
          dateOfBirth:
            (profileRaw.dateOfBirth as string | undefined) ??
            (profileRaw.date_of_birth as string | undefined),
          alternatePhone:
            (profileRaw.alternatePhone as string | undefined) ??
            (profileRaw.alternate_phone as string | undefined),
          hasPassport: profileRaw.hasPassport as boolean | undefined,
          passportNumber:
            (profileRaw.passportNumber as string | undefined) ??
            (profileRaw.passport_number as string | undefined),
          passportExpiryDate:
            (profileRaw.passportExpiryDate as string | undefined) ??
            (profileRaw.passport_expiry_date as string | undefined),
          languageExamGiven: profileRaw.languageExamGiven as boolean | undefined,
          visaRefusalDetails:
            (profileRaw.visaRefusalDetails as string | undefined) ??
            (profileRaw.visa_refusal_details as string | undefined),
          preferredCountry:
            (profileRaw.preferredCountry as string | undefined) ??
            (profileRaw.preferred_country as string | undefined),
          fieldOfInterest:
            (profileRaw.fieldOfInterest as string | undefined) ??
            (profileRaw.field_of_interest as string | undefined),
        }
      : undefined;

  return {
    fullName: (body.fullName ?? body.full_name) as string | undefined,
    phone: (body.phone ?? body.phone_number) as string | undefined,
    email: body.email as string | undefined,
    city: body.city as string | undefined,
    profile,
    education: body.education as LeadSelfEditInput["education"],
    languageScores: (body.languageScores ?? body.language_scores) as LeadSelfEditInput["languageScores"],
    familyMembers: (body.familyMembers ?? body.family_members) as LeadSelfEditInput["familyMembers"],
  };
}

export const getLeadSelfEditController = async (
  req: LeadEditTokenRequest,
  res: Response
): Promise<void> => {
  const token = req.leadEditToken;
  if (!token) {
    res.status(401).json({ success: false, message: "Invalid or expired edit link" });
    return;
  }

  try {
    const data = await getLeadForSelfEdit(token.leadId);
    if (!data) {
      res.status(404).json({ success: false, message: "Invalid or expired edit link" });
      return;
    }

    res.json({
      success: true,
      data,
      expiresAt: token.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[leadSelfEdit] get error:", err);
    res.status(500).json({ success: false, message: "Failed to load registration" });
  }
};

export const patchLeadSelfEditController = async (
  req: LeadEditTokenRequest,
  res: Response
): Promise<void> => {
  const token = req.leadEditToken;
  if (!token) {
    res.status(401).json({ success: false, message: "Invalid or expired edit link" });
    return;
  }

  const input = parseSelfEditBody((req.body ?? {}) as Record<string, unknown>);
  const hasUpdates =
    input.fullName !== undefined ||
    input.phone !== undefined ||
    input.email !== undefined ||
    input.city !== undefined ||
    input.profile !== undefined ||
    input.education !== undefined ||
    input.languageScores !== undefined ||
    input.familyMembers !== undefined;

  if (!hasUpdates) {
    res.status(400).json({ success: false, message: "No fields to update" });
    return;
  }

  if (input.phone !== undefined && !String(input.phone).trim()) {
    res.status(400).json({ success: false, message: "Phone is required" });
    return;
  }

  if (input.fullName !== undefined && !String(input.fullName).trim()) {
    res.status(400).json({ success: false, message: "Full name is required" });
    return;
  }

  try {
    const data = await updateLeadForSelfEdit(token.leadId, input, {
      tokenId: token.id,
      createdByUserId: token.createdByUserId,
    });

    res.json({
      success: true,
      message: "Registration updated successfully",
      data,
      expiresAt: token.expiresAt.toISOString(),
    });
  } catch (err) {
    console.error("[leadSelfEdit] patch error:", err);
    const msg = err instanceof Error ? err.message : "Failed to update registration";
    const status = msg.includes("assigned to a counsellor") ? 422 : 500;
    res.status(status).json({ success: false, message: msg });
  }
};
