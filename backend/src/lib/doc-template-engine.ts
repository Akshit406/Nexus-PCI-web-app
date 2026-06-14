import { execFile, execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import Docxtemplater from "docxtemplater";
import PizZip from "pizzip";

const execFileAsync = promisify(execFile);

// LibreOffice converts the filled .docx/.pptx to PDF in production. Locally
// (no soffice installed) callers fall back to the pdfkit generators.
const LIBREOFFICE_BINARY = process.env.LIBREOFFICE_BINARY || "soffice";
const LIBREOFFICE_PROFILE_DIR = process.env.LIBREOFFICE_PROFILE_DIR || path.join(os.tmpdir(), "lo-profile");
const CONVERT_TIMEOUT_MS = Number(process.env.LIBREOFFICE_TIMEOUT_MS || 120000);

export function getTemplatesDir() {
  return process.env.TEMPLATES_DIR || path.resolve(process.cwd(), "templates");
}

let conversionAvailable: boolean | null = null;

// Cached probe so we only shell out to `soffice --version` once per process.
export function isPdfConversionAvailable(): boolean {
  if (conversionAvailable !== null) {
    return conversionAvailable;
  }
  try {
    execFileSync(LIBREOFFICE_BINARY, ["--version"], { stdio: "ignore", timeout: 15000 });
    conversionAvailable = true;
  } catch {
    conversionAvailable = false;
  }
  return conversionAvailable;
}

export type TemplateDelimiters = { start: string; end: string };

export type FillOptions = {
  // Office stores text in multiple runs; docxtemplater needs custom delimiters
  // for the diploma .pptx which uses << >> instead of the default { }.
  delimiters?: TemplateDelimiters;
};

// Fills an Office Open XML template (.docx or .pptx) with `data` and returns
// the rendered file as a Buffer. Missing tags resolve to "" so generation is
// never blocked by an unset optional field.
export function fillTemplate(templateBuffer: Buffer, data: Record<string, unknown>, options: FillOptions = {}): Buffer {
  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: options.delimiters,
    nullGetter() {
      return "";
    },
  });
  doc.render(data);
  return doc.getZip().generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

// Converts a rendered Office file buffer to PDF using headless LibreOffice.
// Throws when conversion is unavailable; callers decide on the fallback.
export async function convertOfficeBufferToPdf(input: Buffer, ext: "docx" | "pptx"): Promise<Buffer> {
  if (!isPdfConversionAvailable()) {
    throw new Error("LibreOffice (soffice) is not available for PDF conversion.");
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "pcidoc-"));
  const profileDir = path.join(workDir, "lo-profile");
  try {
    const inputPath = path.join(workDir, `document.${ext}`);
    await fs.mkdir(profileDir, { recursive: true });
    await fs.mkdir(LIBREOFFICE_PROFILE_DIR, { recursive: true }).catch(() => undefined);
    await fs.writeFile(inputPath, input);
    try {
      await execFileAsync(
        LIBREOFFICE_BINARY,
        [
          "--headless",
          "--norestore",
          "--nologo",
          "--nodefault",
          "--nofirststartwizard",
          "--nolockcheck",
          `-env:UserInstallation=file://${profileDir}`,
          "--convert-to",
          "pdf",
          "--outdir",
          workDir,
          inputPath,
        ],
        { timeout: CONVERT_TIMEOUT_MS },
      );
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error);
      const stdout = typeof (error as { stdout?: unknown }).stdout === "string" ? (error as { stdout: string }).stdout.trim() : "";
      const stderr = typeof (error as { stderr?: unknown }).stderr === "string" ? (error as { stderr: string }).stderr.trim() : "";
      throw new Error(
        [
          `LibreOffice failed to convert ${ext} to PDF.`,
          details,
          stdout ? `stdout: ${stdout}` : "",
          stderr ? `stderr: ${stderr}` : "",
        ].filter(Boolean).join(" "),
      );
    }
    const outputPath = path.join(workDir, "document.pdf");
    return await fs.readFile(outputPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

// Reads a bundled template by relative path (e.g. "saq/PCIDSSv401SAQP2PELA.docx").
export async function readTemplate(relativePath: string): Promise<Buffer> {
  return fs.readFile(path.join(getTemplatesDir(), relativePath));
}

function xmlEscape(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type DiplomaTemplateData = {
  companyName: string;
  startDate: string;
  endDate: string;
};

// The diploma .pptx is a static slide with three contiguous placeholders
// (<<empresa>>, <<fecha de certificacion>>, <<fecha de conclusion>>) inside
// single text runs, so a direct (and run-safe) substitution keeps the slide's
// background/logos exactly as designed. Accents are matched loosely to avoid
// encoding mismatches.
export function fillDiplomaPptx(templateBuffer: Buffer, data: DiplomaTemplateData): Buffer {
  const zip = new PizZip(templateBuffer);
  const slidePath = "ppt/slides/slide1.xml";
  const slide = zip.file(slidePath);
  if (!slide) {
    throw new Error("Diploma template is missing ppt/slides/slide1.xml");
  }
  const xml = slide
    .asText()
    .replace(/&lt;&lt;\s*empresa\s*&gt;&gt;/g, xmlEscape(data.companyName))
    .replace(/&lt;&lt;\s*fecha de certificaci[^&]*&gt;&gt;/g, xmlEscape(data.startDate))
    .replace(/&lt;&lt;\s*fecha de conclusi[^&]*&gt;&gt;/g, xmlEscape(data.endDate));
  zip.file(slidePath, xml);
  return zip.generate({ type: "nodebuffer", compression: "DEFLATE" }) as Buffer;
}

// Reads the diploma template, substitutes placeholders, and converts to PDF.
export async function renderDiplomaPdf(data: DiplomaTemplateData): Promise<Buffer> {
  const { DIPLOMA_TEMPLATE } = await import("./saq-template-map");
  const template = await readTemplate(DIPLOMA_TEMPLATE);
  const filled = fillDiplomaPptx(template, data);
  return convertOfficeBufferToPdf(filled, "pptx");
}

// End-to-end: read template -> fill -> convert to PDF.
export async function renderTemplateToPdf(
  relativeTemplatePath: string,
  data: Record<string, unknown>,
  options: FillOptions = {},
): Promise<Buffer> {
  const ext = relativeTemplatePath.toLowerCase().endsWith(".pptx") ? "pptx" : "docx";
  const template = await readTemplate(relativeTemplatePath);
  const filled = fillTemplate(template, data, options);
  return convertOfficeBufferToPdf(filled, ext);
}
