import PizZip from "pizzip";

const TEXT_PATTERN = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
const PARAGRAPH_PATTERN = /<w:p\b[\s\S]*?<\/w:p>/g;

function visibleText(xml: string) {
  return Array.from(xml.matchAll(TEXT_PATTERN), (match) => match[1] ?? "")
    .join(" ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function embedMerchantSignature(zip: PizZip, documentXml: string, imageDataUrl?: string | null) {
  if (!imageDataUrl) return documentXml;
  const match = imageDataUrl.match(/^data:image\/(png|jpeg|jpg);base64,(.+)$/s);
  if (!match) return documentXml;

  const extension = match[1] === "jpg" ? "jpeg" : match[1];
  const image = Buffer.from(match[2], "base64");
  if (!image.length) return documentXml;

  const signatureParagraph = Array.from(documentXml.matchAll(PARAGRAPH_PATTERN))
    .find((paragraph) => /Firma del Ejecutivo de.*(?:Comerciante|Proveedor de Servicios)/i.test(visibleText(paragraph[0])));
  if (signatureParagraph?.index === undefined) return documentXml;

  const relationshipId = "rIdPciNexusMerchantSignature";
  const mediaName = `pci-nexus-merchant-signature.${extension}`;
  zip.file(`word/media/${mediaName}`, image);

  const relationshipsFile = zip.file("word/_rels/document.xml.rels");
  if (relationshipsFile) {
    let relationships = relationshipsFile.asText();
    if (!relationships.includes(relationshipId)) {
      relationships = relationships.replace(
        "</Relationships>",
        `<Relationship Id="${relationshipId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${mediaName}"/></Relationships>`,
      );
      zip.file("word/_rels/document.xml.rels", relationships);
    }
  }

  const contentTypesFile = zip.file("[Content_Types].xml");
  if (contentTypesFile) {
    let contentTypes = contentTypesFile.asText();
    if (!new RegExp(`Extension="${extension}"`, "i").test(contentTypes)) {
      const contentType = extension === "png" ? "image/png" : "image/jpeg";
      contentTypes = contentTypes.replace("</Types>", `<Default Extension="${extension}" ContentType="${contentType}"/></Types>`);
      zip.file("[Content_Types].xml", contentTypes);
    }
  }

  const drawing = `<w:r><w:drawing xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="1371600" cy="457200"/><wp:docPr id="900001" name="Firma del comerciante"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="0" name="${mediaName}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1371600" cy="457200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  const paragraph = signatureParagraph[0].replace("</w:p>", `${drawing}</w:p>`);
  const start = signatureParagraph.index;
  return `${documentXml.slice(0, start)}${paragraph}${documentXml.slice(start + signatureParagraph[0].length)}`;
}
