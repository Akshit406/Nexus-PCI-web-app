import { useMemo, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import {
  AdminCertificationReopenedResponse,
  AdminClientCreatedResponse,
  AdminClientItem,
  AdminClientManagementResponse,
  AdminClientUpdatedResponse,
  AdminClientUserCreatedResponse,
  AdminClientUserUpdatedResponse,
} from "../types";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function isStrongPassword(value: string) {
  return value.length >= 8 && /[A-Z]/.test(value) && (value.match(/\d/g) ?? []).length >= 2 && /[^A-Za-z0-9]/.test(value);
}

function RequiredLabel({ children }: { children: string }) {
  return <>{children} <span className="required-marker" aria-hidden="true">*</span></>;
}

const PAYMENT_OPTIONS = [
  { value: "UNPAID", label: "Pendiente" },
  { value: "PAID", label: "Pagado" },
  { value: "PENDING", label: "En revision" },
  { value: "OVERDUE", label: "Vencido" },
];

type ClientForm = {
  companyName: string;
  businessType: string;
  dbaName: string;
  website: string;
  taxId: string;
  postalAddress: string;
  fiscalAddress: string;
  primaryContactName: string;
  primaryContactTitle: string;
  primaryContactEmail: string;
  primaryContactPhone: string;
  adminContactName: string;
  adminContactEmail: string;
  adminContactPhone: string;
  username: string;
  temporaryPassword: string;
  saqTypeId: string;
  cycleYear: string;
  paymentState: string;
  executiveUserId: string;
};

type UserForm = {
  fullName: string;
  email: string;
  username: string;
  temporaryPassword: string;
  isPrimary: boolean;
  isActive: boolean;
};

const initialForm: ClientForm = {
  companyName: "",
  businessType: "",
  dbaName: "",
  website: "",
  taxId: "",
  postalAddress: "",
  fiscalAddress: "",
  primaryContactName: "",
  primaryContactTitle: "",
  primaryContactEmail: "",
  primaryContactPhone: "",
  adminContactName: "",
  adminContactEmail: "",
  adminContactPhone: "",
  username: "",
  temporaryPassword: "Temp1234!",
  saqTypeId: "",
  cycleYear: String(new Date().getFullYear()),
  paymentState: "UNPAID",
  executiveUserId: "",
};

const initialUserForm: UserForm = {
  fullName: "",
  email: "",
  username: "",
  temporaryPassword: "Temp1234!",
  isPrimary: false,
  isActive: true,
};

function slugifyUsername(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 28);
}

function clientToForm(client: AdminClientItem): ClientForm {
  return {
    companyName: client.companyName,
    businessType: client.businessType,
    dbaName: client.dbaName ?? "",
    website: client.website ?? "",
    taxId: client.taxId ?? "",
    postalAddress: client.postalAddress ?? "",
    fiscalAddress: client.fiscalAddress ?? "",
    primaryContactName: client.primaryContactName ?? "",
    primaryContactTitle: client.primaryContactTitle ?? "",
    primaryContactEmail: client.primaryContactEmail ?? "",
    primaryContactPhone: client.primaryContactPhone ?? "",
    adminContactName: client.adminContactName ?? "",
    adminContactEmail: client.adminContactEmail ?? "",
    adminContactPhone: client.adminContactPhone ?? "",
    username: client.username ?? "",
    temporaryPassword: "",
    saqTypeId: client.currentCertification?.saqTypeId ?? "",
    cycleYear: client.currentCertification ? String(client.currentCertification.cycleYear) : String(new Date().getFullYear()),
    paymentState: client.currentCertification?.paymentState ?? "UNPAID",
    executiveUserId: client.executiveUserId ?? "",
  };
}

function userToForm(user: AdminClientItem["users"][number]): UserForm {
  return {
    fullName: `${user.firstName} ${user.lastName}`.trim(),
    email: user.email,
    username: user.username,
    temporaryPassword: "",
    isPrimary: user.isPrimary,
    isActive: user.isActive,
  };
}

type SortKey =
  | "company-asc"
  | "company-desc"
  | "status"
  | "payment"
  | "executive"
  | "cycle-desc";

const STATUS_FILTER_OPTIONS = [
  { value: "ALL", label: "Todos los estados" },
  { value: "PENDING_SAQ_ASSIGNMENT", label: "Pendiente de SAQ" },
  { value: "ASSIGNED_SAQ", label: "SAQ asignado" },
  { value: "IN_PROGRESS", label: "En proceso" },
  { value: "FINALIZED", label: "Finalizado" },
  { value: "SUSPENDED", label: "Suspendido" },
];

const PAYMENT_FILTER_OPTIONS = [
  { value: "ALL", label: "Todos los pagos" },
  { value: "PAID", label: "Pagado" },
  { value: "PENDING", label: "En revision" },
  { value: "UNPAID", label: "Pendiente" },
  { value: "OVERDUE", label: "Vencido" },
];

const SORT_OPTIONS: Array<{ value: SortKey; label: string }> = [
  { value: "company-asc", label: "Empresa (A-Z)" },
  { value: "company-desc", label: "Empresa (Z-A)" },
  { value: "status", label: "Estado" },
  { value: "payment", label: "Estado de pago" },
  { value: "executive", label: "Ejecutivo asignado" },
  { value: "cycle-desc", label: "Ciclo (mas reciente primero)" },
];

function escapeCsv(value: unknown): string {
  if (value === null || value === undefined) return "";
  const stringValue = typeof value === "string" ? value : String(value);
  return /[",\n\r]/.test(stringValue) ? `"${stringValue.replace(/"/g, '""')}"` : stringValue;
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n");
  const blob = new Blob([`\uFEFF${csv}`], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function AdminClientsPage() {
  const queryClient = useQueryClient();
  const [form, setForm] = useState<ClientForm>(initialForm);
  const [userForm, setUserForm] = useState<UserForm>(initialUserForm);
  const [showPassword, setShowPassword] = useState(false);
  const [showUserPassword, setShowUserPassword] = useState(false);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [error, setError] = useState("");
  const [userError, setUserError] = useState("");
  const [createdClient, setCreatedClient] = useState<AdminClientCreatedResponse | null>(null);
  const [updatedClient, setUpdatedClient] = useState<AdminClientUpdatedResponse | null>(null);
  const [createdUser, setCreatedUser] = useState<AdminClientUserCreatedResponse | null>(null);
  const [updatedUser, setUpdatedUser] = useState<AdminClientUserUpdatedResponse | null>(null);
  const [reopenReason, setReopenReason] = useState("");
  const [reopenArchive, setReopenArchive] = useState(true);
  const [reopenSuccess, setReopenSuccess] = useState<AdminCertificationReopenedResponse | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [paymentFilter, setPaymentFilter] = useState("ALL");
  const [executiveFilter, setExecutiveFilter] = useState("ALL");
  const [saqFilter, setSaqFilter] = useState("ALL");
  const [lockedFilter, setLockedFilter] = useState<"ALL" | "LOCKED" | "UNLOCKED">("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("company-asc");

  const clientsQuery = useQuery({
    queryKey: ["admin-clients"],
    queryFn: () => api.get<AdminClientManagementResponse>("/admin/clients"),
  });

  const selectedClient = useMemo(
    () => clientsQuery.data?.items.find((client) => client.id === selectedClientId) ?? null,
    [clientsQuery.data?.items, selectedClientId],
  );

  const filteredClients = useMemo(() => {
    const items = clientsQuery.data?.items ?? [];
    const executivesById = new Map(
      (clientsQuery.data?.executives ?? []).map((executive) => [executive.id, executive]),
    );
    const search = searchTerm.trim().toLowerCase();

    const filtered = items.filter((client) => {
      if (statusFilter !== "ALL" && client.status !== statusFilter) return false;
      const paymentState = client.currentCertification?.paymentState ?? "UNPAID";
      if (paymentFilter !== "ALL" && paymentState !== paymentFilter) return false;
      if (executiveFilter === "NONE") {
        if (client.executiveUserId) return false;
      } else if (executiveFilter !== "ALL") {
        if (client.executiveUserId !== executiveFilter) return false;
      }
      if (saqFilter !== "ALL" && client.currentCertification?.saqTypeId !== saqFilter) return false;
      if (lockedFilter === "LOCKED" && !client.currentCertification?.isLocked) return false;
      if (lockedFilter === "UNLOCKED" && client.currentCertification?.isLocked) return false;
      if (!search) return true;
      const haystack = [
        client.companyName,
        client.businessType,
        client.primaryContactName ?? "",
        client.primaryContactEmail ?? "",
        client.adminContactName ?? "",
        client.adminContactEmail ?? "",
        client.username ?? "",
        client.currentCertification?.saqTypeCode ?? "",
        client.currentCertification?.saqTypeName ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(search);
    });

    const executiveName = (id: string | null | undefined) => {
      if (!id) return "";
      const executive = executivesById.get(id);
      return executive ? `${executive.firstName} ${executive.lastName}`.toLowerCase() : "";
    };

    return [...filtered].sort((left, right) => {
      switch (sortKey) {
        case "company-desc":
          return right.companyName.localeCompare(left.companyName, "es");
        case "status":
          return left.status.localeCompare(right.status);
        case "payment": {
          const leftPayment = left.currentCertification?.paymentState ?? "UNPAID";
          const rightPayment = right.currentCertification?.paymentState ?? "UNPAID";
          return leftPayment.localeCompare(rightPayment);
        }
        case "executive":
          return executiveName(left.executiveUserId).localeCompare(executiveName(right.executiveUserId), "es");
        case "cycle-desc":
          return (right.currentCertification?.cycleYear ?? 0) - (left.currentCertification?.cycleYear ?? 0);
        case "company-asc":
        default:
          return left.companyName.localeCompare(right.companyName, "es");
      }
    });
  }, [
    clientsQuery.data?.items,
    clientsQuery.data?.executives,
    searchTerm,
    statusFilter,
    paymentFilter,
    executiveFilter,
    saqFilter,
    lockedFilter,
    sortKey,
  ]);

  function handleExportCsv() {
    const executivesById = new Map(
      (clientsQuery.data?.executives ?? []).map((executive) => [executive.id, executive]),
    );
    const header = [
      "companyName",
      "businessType",
      "status",
      "primaryContactName",
      "primaryContactEmail",
      "primaryContactPhone",
      "adminContactName",
      "adminContactEmail",
      "adminContactPhone",
      "username",
      "userCount",
      "assignedExecutive",
      "saqTypeCode",
      "saqTypeName",
      "cycleYear",
      "certificationStatus",
      "paymentState",
      "isLocked",
      "finalizedAt",
    ];
    const rows = filteredClients.map((client) => {
      const executive = client.executiveUserId ? executivesById.get(client.executiveUserId) : null;
      return [
        client.companyName,
        client.businessType ?? "",
        client.status,
        client.primaryContactName ?? "",
        client.primaryContactEmail ?? "",
        client.primaryContactPhone ?? "",
        client.adminContactName ?? "",
        client.adminContactEmail ?? "",
        client.adminContactPhone ?? "",
        client.username ?? "",
        String(client.users.length),
        executive ? `${executive.firstName} ${executive.lastName}` : "",
        client.currentCertification?.saqTypeCode ?? "",
        client.currentCertification?.saqTypeName ?? "",
        client.currentCertification ? String(client.currentCertification.cycleYear) : "",
        client.currentCertification?.status ?? "",
        client.currentCertification?.paymentState ?? "",
        client.currentCertification?.isLocked ? "true" : "false",
        client.currentCertification?.finalizedAt ?? "",
      ];
    });
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(`pcinexus-clientes-${today}.csv`, [header, ...rows]);
  }

  const selectedSaqType = useMemo(
    () => clientsQuery.data?.saqTypes.find((saqType) => saqType.id === form.saqTypeId) ?? null,
    [clientsQuery.data?.saqTypes, form.saqTypeId],
  );

  const isEditing = Boolean(selectedClientId);
  const isEditingUser = Boolean(selectedUserId);

  function updateField(key: keyof ClientForm, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateUserField(key: keyof UserForm, value: string | boolean) {
    setUserForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "isPrimary" && value === true) {
        next.isActive = true;
      }
      if (key === "isActive" && value === false) {
        next.isPrimary = false;
      }
      return next;
    });
  }

  function applyCompanyName(value: string) {
    setForm((current) => ({
      ...current,
      companyName: value,
      username: current.username || slugifyUsername(value),
    }));
  }

  function resetReopenState() {
    setReopenReason("");
    setReopenArchive(true);
    setReopenSuccess(null);
  }

  function startCreateMode() {
    setSelectedClientId("");
    setSelectedUserId("");
    setForm(initialForm);
    setUserForm(initialUserForm);
    setError("");
    setUserError("");
    setCreatedClient(null);
    setUpdatedClient(null);
    setCreatedUser(null);
    setUpdatedUser(null);
    resetReopenState();
  }

  function startEditMode(client: AdminClientItem) {
    setSelectedClientId(client.id);
    setSelectedUserId("");
    setForm(clientToForm(client));
    setUserForm(initialUserForm);
    setError("");
    setUserError("");
    setCreatedClient(null);
    setUpdatedClient(null);
    setCreatedUser(null);
    setUpdatedUser(null);
    resetReopenState();
  }

  function startAddUserMode() {
    setSelectedUserId("");
    setUserForm(initialUserForm);
    setUserError("");
    setCreatedUser(null);
    setUpdatedUser(null);
  }

  function startEditUserMode(user: AdminClientItem["users"][number]) {
    setSelectedUserId(user.id);
    setUserForm(userToForm(user));
    setUserError("");
    setCreatedUser(null);
    setUpdatedUser(null);
  }

  const createMutation = useMutation({
    mutationFn: () =>
      api.post<AdminClientCreatedResponse>("/admin/clients", {
        ...form,
        cycleYear: Number(form.cycleYear),
        executiveUserId: form.executiveUserId || undefined,
      }),
    onSuccess(created) {
      setCreatedClient(created);
      setUpdatedClient(null);
      setError("");
      setForm({
        ...initialForm,
        saqTypeId: form.saqTypeId,
        cycleYear: form.cycleYear,
      });
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError(error) {
      setCreatedClient(null);
      setError(error instanceof Error ? error.message : "No fue posible crear el cliente.");
    },
  });

  const updateMutation = useMutation({
    mutationFn: () =>
      api.patch<AdminClientUpdatedResponse>(`/admin/clients/${selectedClientId}`, {
        ...form,
        cycleYear: Number(form.cycleYear),
        executiveUserId: form.executiveUserId || undefined,
        temporaryPassword: form.temporaryPassword || undefined,
      }),
    onSuccess(updated) {
      setUpdatedClient(updated);
      setCreatedClient(null);
      setError("");
      setForm((current) => ({ ...current, temporaryPassword: "" }));
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError(error) {
      setUpdatedClient(null);
      setError(error instanceof Error ? error.message : "No fue posible actualizar el cliente.");
    },
  });

  const reopenMutation = useMutation({
    mutationFn: () => {
      const certificationId = selectedClient?.currentCertification?.id;
      if (!selectedClientId || !certificationId) {
        return Promise.reject(new Error("Selecciona un cliente con certificacion bloqueada."));
      }
      return api.post<AdminCertificationReopenedResponse>(
        `/admin/clients/${selectedClientId}/certifications/${certificationId}/reopen`,
        {
          reason: reopenReason.trim(),
          archiveGeneratedDocuments: reopenArchive,
        },
      );
    },
    onSuccess(result) {
      setReopenSuccess(result);
      setReopenReason("");
      setError("");
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError(error) {
      setReopenSuccess(null);
      setError(error instanceof Error ? error.message : "No fue posible reabrir la certificacion.");
    },
  });

  const addUserMutation = useMutation({
    mutationFn: () =>
      api.post<AdminClientUserCreatedResponse>(`/admin/clients/${selectedClientId}/users`, userForm),
    onSuccess(created) {
      setCreatedUser(created);
      setUpdatedUser(null);
      setUserError("");
      setUserForm(initialUserForm);
      setSelectedUserId("");
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError(error) {
      setCreatedUser(null);
      setUserError(error instanceof Error ? error.message : "No fue posible crear el usuario.");
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: () =>
      api.patch<AdminClientUserUpdatedResponse>(`/admin/clients/${selectedClientId}/users/${selectedUserId}`, {
        ...userForm,
        temporaryPassword: userForm.temporaryPassword || undefined,
      }),
    onSuccess(updated) {
      setUpdatedUser(updated);
      setCreatedUser(null);
      setUserError("");
      setUserForm((current) => ({ ...current, temporaryPassword: "" }));
      queryClient.invalidateQueries({ queryKey: ["admin-clients"] });
    },
    onError(error) {
      setUpdatedUser(null);
      setUserError(error instanceof Error ? error.message : "No fue posible actualizar el usuario.");
    },
  });

  if (clientsQuery.isLoading) {
    return <div className="loading-panel">Cargando clientes y SAQ...</div>;
  }

  if (clientsQuery.isError || !clientsQuery.data) {
    return (
      <div className="error-panel">
        No fue posible cargar la administracion de clientes. {getErrorMessage(clientsQuery.error, "Revisa la sesion, permisos de administrador o configuracion del servidor.")}
      </div>
    );
  }

  const passwordValid = isEditing ? !form.temporaryPassword || isStrongPassword(form.temporaryPassword) : isStrongPassword(form.temporaryPassword);
  const canSubmit =
    form.companyName.trim() &&
    form.businessType.trim() &&
    form.primaryContactName.trim() &&
    form.primaryContactEmail.trim() &&
    form.username.trim() &&
    passwordValid &&
    form.saqTypeId &&
    Number(form.cycleYear);
  const canAddUser =
    selectedClientId &&
    userForm.fullName.trim() &&
    userForm.email.trim() &&
    userForm.username.trim() &&
    isStrongPassword(userForm.temporaryPassword);
  const canSaveUser =
    selectedClientId &&
    userForm.fullName.trim() &&
    userForm.email.trim() &&
    userForm.username.trim() &&
    (isEditingUser ? !userForm.temporaryPassword || isStrongPassword(userForm.temporaryPassword) : isStrongPassword(userForm.temporaryPassword));

  return (
    <div className="page-stack admin-clients-page">
      <section className="page-intro">
        <div>
          <p className="brand-eyebrow">Administrador</p>
          <h1>{isEditing ? "Editar cliente" : "Alta de clientes"}</h1>
          <p className="page-subtitle">
            Crea clientes, ajusta su SAQ/ciclo/pago y administra usuarios de acceso.
          </p>
        </div>
      </section>

      <section className="single-page-card wide admin-client-form-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">{isEditing ? "Cliente seleccionado" : "Nuevo cliente"}</p>
            <h2>Datos de empresa, acceso y SAQ</h2>
          </div>
          <div className="documents-action-row">
            {selectedSaqType ? <span className="soft-badge">SAQ {selectedSaqType.code}</span> : null}
            {isEditing ? (
              <button type="button" className="ghost-button" onClick={startCreateMode}>
                Nuevo cliente
              </button>
            ) : null}
          </div>
        </div>

        <div className="documents-form-grid">
          <label className="field">
            <span><RequiredLabel>Empresa</RequiredLabel></span>
            <input value={form.companyName} onChange={(event) => applyCompanyName(event.target.value)} placeholder="Nombre legal del comercio" />
          </label>
          <label className="field">
            <span><RequiredLabel>Tipo de negocio</RequiredLabel></span>
            <input value={form.businessType} onChange={(event) => updateField("businessType", event.target.value)} placeholder="Ej. Comercio electronico" />
          </label>
          <label className="field">
            <span>Nombre comercial</span>
            <input value={form.dbaName} onChange={(event) => updateField("dbaName", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Sitio web</span>
            <input value={form.website} onChange={(event) => updateField("website", event.target.value)} placeholder="https://..." />
          </label>
          <label className="field">
            <span>RFC / ID fiscal</span>
            <input value={form.taxId} onChange={(event) => updateField("taxId", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Direccion postal</span>
            <input value={form.postalAddress} onChange={(event) => updateField("postalAddress", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Direccion fiscal</span>
            <input value={form.fiscalAddress} onChange={(event) => updateField("fiscalAddress", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span><RequiredLabel>Contacto principal</RequiredLabel></span>
            <input value={form.primaryContactName} onChange={(event) => updateField("primaryContactName", event.target.value)} placeholder="Nombre y apellido" />
          </label>
          <label className="field">
            <span>Cargo del contacto</span>
            <input value={form.primaryContactTitle} onChange={(event) => updateField("primaryContactTitle", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span><RequiredLabel>Correo del contacto</RequiredLabel></span>
            <input value={form.primaryContactEmail} onChange={(event) => updateField("primaryContactEmail", event.target.value)} placeholder="cliente@empresa.com" />
          </label>
          <label className="field">
            <span>Telefono del contacto</span>
            <input value={form.primaryContactPhone} onChange={(event) => updateField("primaryContactPhone", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Contacto administrativo</span>
            <input value={form.adminContactName} onChange={(event) => updateField("adminContactName", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Correo administrativo</span>
            <input value={form.adminContactEmail} onChange={(event) => updateField("adminContactEmail", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span>Telefono administrativo</span>
            <input value={form.adminContactPhone} onChange={(event) => updateField("adminContactPhone", event.target.value)} placeholder="Opcional" />
          </label>
          <label className="field">
            <span><RequiredLabel>Usuario de acceso principal</RequiredLabel></span>
            <input value={form.username} onChange={(event) => updateField("username", event.target.value)} placeholder="usuario_cliente" />
          </label>
          <label className="field">
            <span>{isEditing ? "Nueva contrasena temporal" : <RequiredLabel>Contrasena temporal</RequiredLabel>}</span>
            <div className="password-input-wrap">
              <input 
                type={showPassword ? "text" : "password"}
                value={form.temporaryPassword} 
                onChange={(event) => updateField("temporaryPassword", event.target.value)} 
                placeholder={isEditing ? "Opcional para restablecer" : "Temp1234!"} 
              />
              <button 
                type="button" 
                className="password-toggle" 
                onClick={() => setShowPassword(!showPassword)}
                title={showPassword ? "Ocultar contraseña" : "Ver contraseña"}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            <small>{isEditing ? "Dejalo vacio para conservarla. " : ""}Minimo 8 caracteres, una mayuscula, dos numeros y un caracter especial.</small>
          </label>
          <label className="field">
            <span><RequiredLabel>Tipo de SAQ</RequiredLabel></span>
            <select value={form.saqTypeId} onChange={(event) => updateField("saqTypeId", event.target.value)}>
              <option value="">Selecciona un SAQ</option>
              {clientsQuery.data.saqTypes.map((saqType) => (
                <option key={saqType.id} value={saqType.id}>
                  {saqType.code} - {saqType.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span><RequiredLabel>Ciclo</RequiredLabel></span>
            <input type="number" value={form.cycleYear} onChange={(event) => updateField("cycleYear", event.target.value)} />
          </label>
          <label className="field">
            <span>Estado de pago</span>
            <select value={form.paymentState} onChange={(event) => updateField("paymentState", event.target.value)}>
              {PAYMENT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ejecutivo asignado</span>
            <select value={form.executiveUserId} onChange={(event) => updateField("executiveUserId", event.target.value)}>
              <option value="">Sin ejecutivo asignado</option>
              {clientsQuery.data.executives.map((executive) => (
                <option key={executive.id} value={executive.id}>
                  {executive.firstName} {executive.lastName} ({executive.username})
                </option>
              ))}
            </select>
          </label>
        </div>

        {error ? <p className="error-text">{error}</p> : null}
        {createdClient ? (
          <div className="success-panel">
            <strong>Cliente creado correctamente</strong>
            <p>
              Usuario: <b>{createdClient.username}</b> / Contrasena temporal: <b>{createdClient.temporaryPassword}</b>
            </p>
            <p>SAQ {createdClient.saqTypeCode} - Ciclo {createdClient.cycleYear}</p>
          </div>
        ) : null}
        {updatedClient ? (
          <div className="success-panel">
            <strong>Cliente actualizado</strong>
            <p>
              Usuario principal: <b>{updatedClient.username}</b>
              {updatedClient.passwordReset ? " / contrasena temporal restablecida" : ""}
            </p>
            <p>SAQ {updatedClient.saqTypeCode} - Ciclo {updatedClient.cycleYear}</p>
          </div>
        ) : null}

        <button
          type="button"
          className="primary-button"
          disabled={!canSubmit || createMutation.isPending || updateMutation.isPending}
          onClick={() => (isEditing ? updateMutation.mutate() : createMutation.mutate())}
        >
          {createMutation.isPending || updateMutation.isPending
            ? "Guardando..."
            : isEditing
              ? "Guardar cambios del cliente"
              : "Crear cliente"}
        </button>
      </section>

      {selectedClient?.currentCertification?.isLocked ? (
        <section className="single-page-card wide admin-client-form-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Certificacion bloqueada</p>
              <h2>Reabrir certificacion</h2>
              <p className="page-subtitle">
                Esta certificacion ya fue finalizada y los documentos AOC/SAQ se generaron. El cliente no
                puede modificar respuestas ni regenerar los documentos hasta que la reabras. Los datos de
                contacto si pueden actualizarse sin reabrir.
              </p>
            </div>
            <div className="documents-action-row">
              <span className="soft-badge">
                Bloqueada · SAQ {selectedClient.currentCertification.saqTypeCode} · Ciclo {selectedClient.currentCertification.cycleYear}
              </span>
            </div>
          </div>

          <div className="documents-form-grid">
            <label className="field" style={{ gridColumn: "1 / -1" }}>
              <span>Motivo de reapertura</span>
              <textarea
                rows={2}
                value={reopenReason}
                onChange={(event) => setReopenReason(event.target.value)}
                placeholder="Describe por que se reabre la certificacion (minimo 8 caracteres). El cliente recibira esta razon por correo."
              />
              <small>El motivo queda registrado en la bitacora de auditoria.</small>
            </label>
            <label className="checkbox-option" style={{ gridColumn: "1 / -1" }}>
              <input
                type="checkbox"
                checked={reopenArchive}
                onChange={(event) => setReopenArchive(event.target.checked)}
              />
              <span>Archivar los documentos previamente generados (recomendado).</span>
            </label>
          </div>

          {reopenSuccess ? (
            <div className="success-panel">
              <strong>Certificacion reabierta</strong>
              <p>El cliente recibira un correo informativo y ya puede editar y regenerar.</p>
            </div>
          ) : null}

          <button
            type="button"
            className="primary-button"
            disabled={reopenReason.trim().length < 8 || reopenMutation.isPending}
            onClick={() => reopenMutation.mutate()}
          >
            {reopenMutation.isPending ? "Reabriendo..." : "Reabrir certificacion"}
          </button>
        </section>
      ) : null}

      {selectedClient ? (
        <section className="single-page-card wide admin-client-form-card">
          <div className="panel-header">
            <div>
              <p className="brand-eyebrow">Usuarios del cliente</p>
              <h2>{isEditingUser ? "Editar usuario de acceso" : "Agregar usuario de acceso"}</h2>
            </div>
            <div className="documents-action-row">
              <span className="soft-badge">{selectedClient.users.length} usuario(s)</span>
              {isEditingUser ? (
                <button type="button" className="ghost-button" onClick={startAddUserMode}>
                  Nuevo usuario
                </button>
              ) : null}
            </div>
          </div>

          <div className="documents-form-grid">
            <label className="field">
              <span><RequiredLabel>Nombre del usuario</RequiredLabel></span>
              <input
                value={userForm.fullName}
                onChange={(event) => {
                  updateUserField("fullName", event.target.value);
                  if (!userForm.username) {
                    updateUserField("username", slugifyUsername(event.target.value));
                  }
                }}
                placeholder="Nombre y apellido"
              />
            </label>
            <label className="field">
              <span><RequiredLabel>Correo</RequiredLabel></span>
              <input value={userForm.email} onChange={(event) => updateUserField("email", event.target.value)} placeholder="usuario@empresa.com" />
            </label>
            <label className="field">
              <span><RequiredLabel>Usuario</RequiredLabel></span>
              <input value={userForm.username} onChange={(event) => updateUserField("username", event.target.value)} placeholder="usuario_cliente_2" />
            </label>
            <label className="field">
              <span>{isEditingUser ? "Nueva contrasena temporal" : <RequiredLabel>Contrasena temporal</RequiredLabel>}</span>
              <div className="password-input-wrap">
                <input
                  type={showUserPassword ? "text" : "password"}
                  value={userForm.temporaryPassword}
                  onChange={(event) => updateUserField("temporaryPassword", event.target.value)}
                  placeholder={isEditingUser ? "Opcional para restablecer" : "Temp1234!"}
                />
                <button 
                  type="button" 
                  className="password-toggle" 
                  onClick={() => setShowUserPassword(!showUserPassword)}
                  title={showUserPassword ? "Ocultar contraseña" : "Ver contraseña"}
                >
                  {showUserPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <small>{isEditingUser ? "Dejalo vacio para conservarla. " : ""}Minimo 8 caracteres, una mayuscula, dos numeros y un caracter especial.</small>
            </label>
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={userForm.isPrimary}
                disabled={!userForm.isActive}
                onChange={(event) => updateUserField("isPrimary", event.target.checked)}
              />
              <span>Marcar como usuario principal</span>
            </label>
            <label className="checkbox-option">
              <input
                type="checkbox"
                checked={userForm.isActive}
                onChange={(event) => updateUserField("isActive", event.target.checked)}
              />
              <span>Usuario activo</span>
            </label>
          </div>

          {userError ? <p className="error-text">{userError}</p> : null}

          {createdUser ? (
            <div className="success-panel">
              <strong>Usuario agregado</strong>
              <p>
                Usuario: <b>{createdUser.username}</b> / Contrasena temporal: <b>{createdUser.temporaryPassword}</b>
              </p>
            </div>
          ) : null}
          {updatedUser ? (
            <div className="success-panel">
              <strong>Usuario actualizado</strong>
              <p>
                Usuario: <b>{updatedUser.username}</b>
                {updatedUser.passwordReset ? " / contrasena temporal restablecida" : ""}
              </p>
            </div>
          ) : null}

          <button
            type="button"
            className="primary-button"
            disabled={
              (isEditingUser ? !canSaveUser : !canAddUser) ||
              addUserMutation.isPending ||
              updateUserMutation.isPending
            }
            onClick={() => (isEditingUser ? updateUserMutation.mutate() : addUserMutation.mutate())}
          >
            {addUserMutation.isPending || updateUserMutation.isPending
              ? "Guardando..."
              : isEditingUser
                ? "Guardar cambios del usuario"
                : "Agregar usuario al cliente"}
          </button>

          <div className="outputs-list-stack" style={{ marginTop: "18px" }}>
            {selectedClient.users.map((user) => (
              <article key={user.id} className="mini-card document-list-item">
                <div className="document-list-copy">
                  <strong>{user.firstName} {user.lastName}</strong>
                  <p className="subtle-text">{user.username} · {user.email}</p>
                  <p className="subtle-text">{user.mustChangePassword ? "Debe cambiar contrasena" : "Contrasena actualizada"}</p>
                </div>
                <div className="documents-action-row">
                  <span className="soft-badge">{user.isPrimary ? "Principal" : user.isActive ? "Activo" : "Inactivo"}</span>
                  <button type="button" className="ghost-button" onClick={() => startEditUserMode(user)}>
                    Editar
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <section className="single-page-card wide admin-clients-list-card">
        <div className="panel-header">
          <div>
            <p className="brand-eyebrow">Clientes existentes</p>
            <h2>Clientes registrados</h2>
          </div>
          <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
            <span className="soft-badge">
              {filteredClients.length} / {clientsQuery.data.items.length} clientes
            </span>
            <button
              type="button"
              className="ghost-button"
              onClick={handleExportCsv}
              disabled={filteredClients.length === 0}
              title="Descargar la lista filtrada como CSV"
            >
              Exportar CSV
            </button>
          </div>
        </div>

        <div
          className="field-grid"
          style={{ marginTop: "12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "12px" }}
        >
          <label className="field">
            <span>Buscar</span>
            <input
              type="text"
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              placeholder="Empresa, contacto, usuario, SAQ..."
            />
          </label>
          <label className="field">
            <span>Estado</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              {STATUS_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Pago</span>
            <select value={paymentFilter} onChange={(event) => setPaymentFilter(event.target.value)}>
              {PAYMENT_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Ejecutivo</span>
            <select value={executiveFilter} onChange={(event) => setExecutiveFilter(event.target.value)}>
              <option value="ALL">Todos los ejecutivos</option>
              <option value="NONE">Sin ejecutivo asignado</option>
              {clientsQuery.data.executives.map((executive) => (
                <option key={executive.id} value={executive.id}>
                  {executive.firstName} {executive.lastName}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Tipo SAQ</span>
            <select value={saqFilter} onChange={(event) => setSaqFilter(event.target.value)}>
              <option value="ALL">Todos los SAQ</option>
              {clientsQuery.data.saqTypes.map((saqType) => (
                <option key={saqType.id} value={saqType.id}>
                  {saqType.code} - {saqType.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Bloqueo</span>
            <select
              value={lockedFilter}
              onChange={(event) => setLockedFilter(event.target.value as "ALL" | "LOCKED" | "UNLOCKED")}
            >
              <option value="ALL">Todas</option>
              <option value="LOCKED">Solo bloqueadas</option>
              <option value="UNLOCKED">Solo desbloqueadas</option>
            </select>
          </label>
          <label className="field">
            <span>Ordenar por</span>
            <select value={sortKey} onChange={(event) => setSortKey(event.target.value as SortKey)}>
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="outputs-list-stack" style={{ marginTop: "16px" }}>
          {filteredClients.length === 0 ? (
            <p className="subtle-text">
              Ningun cliente coincide con los filtros actuales. Ajusta o limpia los filtros para ver mas resultados.
            </p>
          ) : (
            filteredClients.map((client) => (
              <article key={client.id} className="mini-card document-list-item">
                <div className="document-list-copy">
                  <strong>{client.companyName}</strong>
                  <p className="subtle-text">
                    {client.businessType} · Usuario: {client.username ?? "Sin usuario"} · {client.users.length} usuario(s)
                  </p>
                  <p className="subtle-text">
                    {client.currentCertification
                      ? `SAQ ${client.currentCertification.saqTypeCode} · ${client.currentCertification.cycleYear} · ${client.currentCertification.paymentState}`
                      : "Sin certificacion activa"}
                  </p>
                </div>
                <div className="documents-action-row">
                  <span className="soft-badge">{client.status}</span>
                  {client.currentCertification?.isLocked ? (
                    <span className="soft-badge" style={{ color: "var(--warning)", borderColor: "var(--warning)" }}>
                      Bloqueada
                    </span>
                  ) : null}
                  <button type="button" className="ghost-button" onClick={() => startEditMode(client)}>
                    Editar
                  </button>
                </div>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
