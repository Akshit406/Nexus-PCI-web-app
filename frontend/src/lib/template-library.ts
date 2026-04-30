// Deprecated reference only. Live templates now come from the backend /templates API
// and are managed by administrators in the app.
export type TemplateLibraryItem = {
  key: string;
  title: string;
  description: string;
  href: string;
  fileType: string;
};

export const templateLibrary: TemplateLibraryItem[] = [
  {
    key: "antimalware-procedimiento",
    title: "Procedimiento de instalacion y validacion antimalware",
    description:
      "Plantilla editable para documentar controles antimalware, alcance operativo y responsables del proceso.",
    href: "/templates/editable/antimalware-procedimiento.docx",
    fileType: "DOCX editable",
  },
  {
    key: "r11-pruebas-seguridad",
    title: "R11 pruebas de seguridad de sistemas y redes",
    description:
      "Plantilla base para formalizar escaneos, revisiones periodicas, hallazgos y seguimiento del requisito 11.",
    href: "/templates/editable/r11-pruebas-seguridad.docx",
    fileType: "DOCX editable",
  },
  {
    key: "r12-politica-seguridad",
    title: "R12 politica de seguridad de la informacion",
    description:
      "Plantilla editable para registrar politica de seguridad, responsabilidades y ciclo de actualizacion documental.",
    href: "/templates/editable/r12-politica-seguridad.docx",
    fileType: "DOCX editable",
  },
];
