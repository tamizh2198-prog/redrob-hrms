import PDFDocument from "pdfkit";
import { COMPANY_LOGO_PNG_BASE64, COO_SIGNATURE_PNG_BASE64, COMPANY_STAMP_PNG_BASE64 } from "./relieving-letter-assets";

// Mirrors "Relieving & Experience Letter.docx" (the company's actual
// letterhead template) field-for-field, including its logo and the COO's
// actual signature (HRMS-23: these were previously rendered as plain text —
// "McKinley Rice" and "Kartikey Handa" — instead of the real images the
// template embeds). The source template's own grammar is inconsistent (a
// stray leftover "e" fragment, a hardcoded "her"/"she" regardless of the
// employee's actual gender) — this renders the intended structure with
// pronouns correctly derived from the employee's gender on file instead of
// reproducing those artifacts literally.
export interface RelievingLetterData {
  employeeName: string;
  employeeCode: string;
  dateOfJoining: string;
  lastWorkingDay: string;
  designation: string;
  location: string;
  department: string;
  gender: "MALE" | "FEMALE" | "OTHER" | "PREFER_NOT_TO_SAY" | null;
  generatedDate: string;
}

function pronounsFor(gender: RelievingLetterData["gender"]) {
  if (gender === "MALE") return { subject: "He", possessive: "his", object: "him" };
  if (gender === "FEMALE") return { subject: "She", possessive: "her", object: "her" };
  return { subject: "They", possessive: "their", object: "them" };
}

export function renderRelievingLetterPdf(data: RelievingLetterData): Promise<Buffer> {
  const { subject, possessive, object } = pronounsFor(data.gender);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 56 });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const logoBuffer = Buffer.from(COMPANY_LOGO_PNG_BASE64, "base64");
    const logoWidth = 140;
    doc.image(logoBuffer, doc.page.width - doc.page.margins.right - logoWidth, doc.y, { width: logoWidth });
    doc.moveDown(2.2);
    doc
      .moveTo(doc.page.margins.left, doc.y)
      .lineTo(doc.page.width - doc.page.margins.right, doc.y)
      .strokeColor("#888888")
      .stroke();
    doc.moveDown(1.5);

    doc.font("Helvetica-Bold").fontSize(13).text("RELIEVING & EXPERIENCE LETTER", { align: "center", underline: true });
    doc.moveDown(1.5);

    doc.font("Helvetica-Bold").fontSize(11);
    doc.text(`Date: ${data.generatedDate}`);
    doc.text(`Employee Name: ${data.employeeName}`);
    doc.text(`Employee ID: ${data.employeeCode}`);
    doc.text(`Date of Joining: ${data.dateOfJoining}`);
    doc.moveDown(1.2);

    doc.font("Helvetica-Bold").fontSize(11).text("To Whomsoever It May Concern", { align: "center" });
    doc.moveDown(1);

    doc.font("Helvetica").fontSize(11);
    doc.text(
      `This is to certify that ${data.employeeName} has successfully completed ${possessive} employment with ` +
        `McKinley Rice having ${possessive} last working day on ${data.lastWorkingDay}. ${subject} joined as ` +
        `${data.designation} based out of ${data.location} Community location.`,
      { align: "justify" },
    );
    doc.moveDown(1);

    doc.text(
      `${subject === "They" ? "Their" : possessive[0].toUpperCase() + possessive.slice(1)} overall performance has ` +
        `been marked good in the ${data.department}. ${data.employeeName}'s efforts and contribution to the ` +
        `McKinley Rice Community towards its growth and success will always be appreciated.`,
      { align: "justify" },
    );
    doc.moveDown(1);

    doc.text(
      "As per the community policy, the full & final settlement (if any) would be done within 30 days of the " +
        "last working day mentioned above.",
      { align: "justify" },
    );
    doc.moveDown(1);

    doc.text(`We wish ${object} all the best for ${possessive} future endeavours.`);
    doc.moveDown(1.8);

    // In the template, the COO's ink signature is stamped directly over the
    // "For Mckinley & Rice Creativity Pvt. Ltd. / Director" authorization
    // seal — both graphics, heavily overlapping — and that whole block sits
    // BEFORE "With Regards,", not after it. HRMS-23 follow-up: an earlier
    // pass got the seal rendering right but placed the block after "With
    // Regards," and stacked the two images with a gap instead of overlapping
    // them, which is what "mismatching" referred to.
    const stampBuffer = Buffer.from(COMPANY_STAMP_PNG_BASE64, "base64");
    const stampWidth = 220;
    const stampHeight = stampWidth * (599 / 2048); // source PNG's own pixel aspect ratio
    const blockTop = doc.y;
    doc.image(stampBuffer, doc.page.margins.left, blockTop, { width: stampWidth });

    // Signature drawn last so it paints on top of (in front of) the seal —
    // offset up and slightly left to match the template's overlap.
    const signatureBuffer = Buffer.from(COO_SIGNATURE_PNG_BASE64, "base64");
    const signatureWidth = 110;
    const signatureHeight = signatureWidth * (180 / 312); // source PNG's own pixel aspect ratio
    doc.image(signatureBuffer, doc.page.margins.left - 14, blockTop + 4, { width: signatureWidth });

    doc.y = blockTop + Math.max(stampHeight, signatureHeight + 4) + 6;

    doc.font("Helvetica-Bold");
    doc.text("With Regards,");
    doc.moveDown(1);

    doc.text("Kartikey Handa");
    doc.text("Chief Operating and Growth Officer (COO)");

    doc.end();
  });
}
