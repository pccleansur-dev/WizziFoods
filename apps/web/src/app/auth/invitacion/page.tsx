import { InvitationFinish } from "./invitation-finish";

export default function InvitationPage() {
  return (
    <main className="mfa-shell">
      <section className="mfa-card" aria-labelledby="invitation-title">
        <p className="access-step">Invitación</p>
        <h1 id="invitation-title">Validando tu invitación</h1>
        <InvitationFinish />
      </section>
    </main>
  );
}
