"use client";

import {
  staffRoleLabels,
  type StaffRole,
  type TeamIssue,
  type TeamMember
} from "@platform/contracts";
import { useState, useTransition, type FormEvent } from "react";

import type { TeamActionState, TeamCommand } from "./team";

type Sector = { id: string; name: string };

const roles = Object.keys(staffRoleLabels) as StaffRole[];

function issueFor(issues: TeamIssue[], path: string): string | undefined {
  return issues.find((issue) => issue.path === path)?.message;
}

export function TeamManager({
  initialMembers,
  onCommand,
  sectors
}: {
  initialMembers: TeamMember[];
  onCommand: (command: TeamCommand) => Promise<TeamActionState>;
  sectors: Sector[];
}) {
  const [members, setMembers] = useState(initialMembers);
  const [feedback, setFeedback] = useState<TeamActionState>({
    issues: [],
    members: null,
    message: "",
    status: "idle"
  });
  const [pending, startTransition] = useTransition();
  const [createRole, setCreateRole] = useState<StaffRole>("waiter");
  const [editing, setEditing] = useState<string | null>(null);

  function run(command: TeamCommand, onDone?: () => void) {
    startTransition(async () => {
      const next = await onCommand(command);
      setFeedback(next);
      if (next.members) setMembers(next.members);
      if (next.status === "saved") onDone?.();
    });
  }

  function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(
      {
        displayName: String(data.get("displayName") ?? ""),
        pin: String(data.get("pin") ?? ""),
        role: createRole,
        sectorIds:
          createRole === "waiter" ? data.getAll("sectorIds").map(String) : [],
        type: "create",
        username: String(data.get("username") ?? "")
      },
      () => form.reset()
    );
  }

  const activeCount = members.filter((member) => member.isActive).length;

  return (
    <section
      className="panel-content team-workspace"
      aria-labelledby="team-title"
    >
      <p className="eyebrow">Equipo</p>
      <h1 id="team-title">Empleados del negocio</h1>
      <p className="panel-lead">
        Cada persona entra con su usuario y un PIN de seis dígitos. El PIN no se
        puede volver a ver: si se olvida, restablecelo. Hay{" "}
        <strong>{activeCount}</strong> empleados activos.
      </p>

      <p
        aria-live="polite"
        className={
          feedback.status === "saved"
            ? "form-message form-message--success"
            : feedback.status === "idle"
              ? "form-message"
              : "form-message form-message--error"
        }
        role={feedback.status === "idle" ? undefined : "status"}
      >
        {feedback.message}
      </p>

      <form className="profile-form team-form" onSubmit={submitCreate}>
        <h2>Nuevo empleado</h2>
        <div className="profile-fields-grid">
          <label className="field-group">
            <span>Nombre</span>
            <input
              autoComplete="off"
              maxLength={120}
              name="displayName"
              required
            />
            <small role="alert">
              {issueFor(feedback.issues, "displayName")}
            </small>
          </label>
          <label className="field-group">
            <span>Usuario</span>
            <input
              autoCapitalize="none"
              autoComplete="off"
              maxLength={64}
              minLength={3}
              name="username"
              required
              spellCheck={false}
            />
            <small role="alert">{issueFor(feedback.issues, "username")}</small>
          </label>
          <label className="field-group">
            <span>PIN (6 dígitos)</span>
            <input
              autoComplete="new-password"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="pin"
              pattern="[0-9]{6}"
              title="El PIN tiene 6 dígitos, sin letras ni espacios."
              required
              type="password"
            />
            <small role="alert">{issueFor(feedback.issues, "pin")}</small>
          </label>
          <label className="field-group">
            <span>Rol</span>
            <select
              name="role"
              onChange={(event) =>
                setCreateRole(event.target.value as StaffRole)
              }
              value={createRole}
            >
              {roles.map((role) => (
                <option key={role} value={role}>
                  {staffRoleLabels[role]}
                </option>
              ))}
            </select>
          </label>
        </div>
        {createRole === "waiter" ? (
          <SectorChoices name="sectorIds" sectors={sectors} selected={[]} />
        ) : null}
        <button
          className="button button--primary"
          disabled={pending}
          type="submit"
        >
          {pending ? "Guardando…" : "Crear empleado"}
        </button>
      </form>

      <ul className="team-list" aria-label="Empleados">
        {members.length === 0 ? (
          <li className="panel-empty-state">Todavía no creaste empleados.</li>
        ) : null}
        {members.map((member) => (
          <MemberCard
            editing={editing === member.id}
            key={member.id}
            member={member}
            onEdit={(open) => setEditing(open ? member.id : null)}
            pending={pending}
            run={run}
            sectors={sectors}
          />
        ))}
      </ul>
    </section>
  );
}

function SectorChoices({
  name,
  sectors,
  selected
}: {
  name: string;
  sectors: Sector[];
  selected: string[];
}) {
  if (sectors.length === 0) {
    return (
      <p className="panel-lead">
        Todavía no hay sectores del salón. Creálos en el plano para asignarlos.
      </p>
    );
  }
  return (
    <fieldset className="team-sectors">
      <legend>Sectores del salón</legend>
      {sectors.map((sector) => (
        <label key={sector.id}>
          <input
            defaultChecked={selected.includes(sector.id)}
            name={name}
            type="checkbox"
            value={sector.id}
          />{" "}
          {sector.name}
        </label>
      ))}
    </fieldset>
  );
}

function MemberCard({
  editing,
  member,
  onEdit,
  pending,
  run,
  sectors
}: {
  editing: boolean;
  member: TeamMember;
  onEdit: (open: boolean) => void;
  pending: boolean;
  run: (command: TeamCommand, onDone?: () => void) => void;
  sectors: Sector[];
}) {
  const [role, setRole] = useState<StaffRole>(member.role);
  const [resetting, setResetting] = useState(false);
  const sectorNames = member.sectorIds
    .map((id) => sectors.find((sector) => sector.id === id)?.name)
    .filter(Boolean)
    .join(", ");

  function submitEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    run(
      {
        displayName: String(data.get("displayName") ?? ""),
        id: member.id,
        role,
        sectorIds:
          role === "waiter" ? data.getAll("sectorIds").map(String) : [],
        type: "update"
      },
      () => onEdit(false)
    );
  }

  function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    run(
      { id: member.id, pin: String(data.get("pin") ?? ""), type: "pin" },
      () => {
        form.reset();
        setResetting(false);
      }
    );
  }

  return (
    <li className="team-card">
      <div className="team-card__summary">
        <div>
          <strong>{member.displayName}</strong>{" "}
          <span
            className={
              member.isActive
                ? "status-pill"
                : "status-pill status-pill--suspended"
            }
          >
            {member.isActive ? "Activo" : "Inactivo"}
          </span>
          <p>
            {staffRoleLabels[member.role]} · usuario{" "}
            <code>{member.username}</code>
            {member.role === "waiter"
              ? ` · ${sectorNames || "sin sectores asignados"}`
              : ""}
          </p>
        </div>
        <div className="team-card__actions">
          <button
            className="button button--secondary"
            disabled={pending}
            onClick={() => onEdit(!editing)}
            type="button"
          >
            {editing ? "Cerrar" : "Editar"}
          </button>
          <button
            className="button button--secondary"
            disabled={pending}
            onClick={() => setResetting((value) => !value)}
            type="button"
          >
            Restablecer PIN
          </button>
          <button
            className={
              member.isActive
                ? "button button--danger"
                : "button button--primary"
            }
            disabled={pending}
            onClick={() =>
              run({ active: !member.isActive, id: member.id, type: "active" })
            }
            type="button"
          >
            {member.isActive ? "Desactivar" : "Reactivar"}
          </button>
        </div>
      </div>

      {editing ? (
        <form className="profile-form" onSubmit={submitEdit}>
          <div className="profile-fields-grid">
            <label className="field-group">
              <span>Nombre</span>
              <input
                defaultValue={member.displayName}
                maxLength={120}
                name="displayName"
                required
              />
            </label>
            <label className="field-group">
              <span>Rol</span>
              <select
                onChange={(event) => setRole(event.target.value as StaffRole)}
                value={role}
              >
                {roles.map((option) => (
                  <option key={option} value={option}>
                    {staffRoleLabels[option]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {role === "waiter" ? (
            <SectorChoices
              name="sectorIds"
              sectors={sectors}
              selected={member.sectorIds}
            />
          ) : null}
          <button
            className="button button--primary"
            disabled={pending}
            type="submit"
          >
            Guardar cambios
          </button>
        </form>
      ) : null}

      {resetting ? (
        <form className="profile-form" onSubmit={submitPin}>
          <label className="field-group">
            <span>Nuevo PIN (6 dígitos)</span>
            <input
              autoComplete="new-password"
              inputMode="numeric"
              maxLength={6}
              minLength={6}
              name="pin"
              pattern="[0-9]{6}"
              title="El PIN tiene 6 dígitos, sin letras ni espacios."
              required
              type="password"
            />
          </label>
          <button
            className="button button--primary"
            disabled={pending}
            type="submit"
          >
            Guardar nuevo PIN
          </button>
        </form>
      ) : null}
    </li>
  );
}
