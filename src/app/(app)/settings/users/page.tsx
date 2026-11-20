import { NewUserForm, UsersManager } from "@/components/settings/users-manager";
import { requireRole } from "@/lib/auth/session";
import { listUsers } from "@/server/users-queries";

export const metadata = { title: "Users · alpha-Manage" };

export default async function UsersSettingsPage() {
  const me = await requireRole("owner");
  const users = await listUsers();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted">
          Staff who can sign in. Sales staff manage customers, quotations and deliveries; owners also see settings and this screen.
        </p>
      </div>
      <UsersManager users={users} currentUserId={me.id} />
      <NewUserForm />
    </>
  );
}
