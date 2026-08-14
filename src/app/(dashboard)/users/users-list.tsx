"use client";

import { useState } from "react";
import Link from "next/link";

interface UserItem {
  userId: number;
  username: string;
  displayName: string;
  email: string | null;
  isActive: string;
  role: { roleName: string; roleId: number };
}

interface RoleItem {
  roleId: number;
  roleName: string;
}

interface Props {
  users: UserItem[];
  roles: RoleItem[];
}

export default function UsersList({ users: initial, roles }: Props) {
  const [users, setUsers] = useState(initial);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editRoleId, setEditRoleId] = useState(0);
  const [editPassword, setEditPassword] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  function startEdit(u: UserItem) {
    setEditingId(u.userId);
    setEditDisplayName(u.displayName);
    setEditEmail(u.email ?? "");
    setEditRoleId(u.role.roleId);
    setEditPassword("");
    setError("");
  }

  function cancelEdit() {
    setEditingId(null);
    setError("");
  }

  async function saveEdit(userId: number) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: editDisplayName,
          email: editEmail,
          roleId: editRoleId,
          password: editPassword || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to update."); setSaving(false); return; }
      setUsers((prev) => prev.map((u) => u.userId === userId ? {
        ...u,
        displayName: editDisplayName,
        email: editEmail || null,
        role: roles.find((r) => r.roleId === editRoleId) ?? u.role,
      } : u));
      cancelEdit();
    } catch { setError("A network error occurred."); }
    setSaving(false);
  }

  async function toggleStatus(userId: number, username: string, current: string) {
    const action = current === "Y" ? "deactivate" : "activate";
    if (!confirm(`Are you sure you want to ${action} ${username}?`)) return;
    setError("");
    try {
      const res = await fetch(`/api/users/${userId}/status`, { method: "PATCH" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to update status."); return; }
      setUsers((prev) => prev.map((u) => u.userId === userId ? { ...u, isActive: data.isActive } : u));
    } catch { setError("A network error occurred."); }
  }

  async function deleteUser(userId: number, username: string) {
    if (!confirm(`Delete user ${username}? This cannot be undone.`)) return;
    setError("");
    try {
      const res = await fetch(`/api/users/${userId}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to delete."); return; }
      setUsers((prev) => prev.filter((u) => u.userId !== userId));
    } catch { setError("A network error occurred."); }
  }

  async function resetMfa(userId: number, username: string) {
    if (!confirm(`Reset MFA for ${username}? They will need to re-enroll at next login.`)) return;
    setError("");
    try {
      const res = await fetch("/api/auth/mfa/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? "Failed to reset MFA."); return; }
      setMessage(data.message ?? "MFA reset.");
    } catch { setError("A network error occurred."); }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground/90">User Management</h2>
          <p className="text-sm text-muted-foreground/60 mt-1">Manage system users and roles</p>
        </div>
        <Link href="/users/register" className="inline-flex items-center gap-1.5 px-4 py-2 bg-primary text-primary-foreground rounded-xl text-xs font-medium hover:bg-primary/90 transition-colors">
          + Register User
        </Link>
      </div>

      {error && (
        <div className="rounded-lg bg-destructive/10 border border-destructive/20 p-3 text-sm text-destructive">{error}</div>
      )}
      {message && (
        <div className="rounded-lg bg-emerald-500/10 border border-emerald-500/20 p-3 text-sm text-emerald-600">{message}</div>
      )}

      <div className="rounded-md border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium text-muted-foreground">Username</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Display Name</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Email</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Role</th>
              <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
              <th className="text-right p-3 font-medium text-muted-foreground">Actions</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr>
                <td colSpan={6} className="p-8 text-center text-muted-foreground">No users found.</td>
              </tr>
            )}
            {users.map((u) => (
              <tr key={u.userId} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="p-3 font-mono text-xs">{u.username}</td>
                <td className="p-3">{u.displayName}</td>
                <td className="p-3 text-xs text-muted-foreground">{u.email || "—"}</td>
                <td className="p-3">{u.role.roleName}</td>
                <td className="p-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${u.isActive === "Y" ? "bg-emerald-500/10 text-emerald-600" : "bg-gray-500/10 text-gray-500"}`}>
                    {u.isActive === "Y" ? "Active" : "Inactive"}
                  </span>
                </td>
                <td className="p-3 text-right whitespace-nowrap">
                  <button onClick={() => startEdit(u)} style={{ color: '#2563eb', fontSize: '0.75rem', marginRight: '0.75rem', border: 'none', background: 'none', cursor: 'pointer' }}>Edit</button>
                  <button onClick={() => resetMfa(u.userId, u.username)} style={{ color: '#7c3aed', fontSize: '0.75rem', marginRight: '0.75rem', border: 'none', background: 'none', cursor: 'pointer' }}>Reset MFA</button>
                  <button onClick={() => toggleStatus(u.userId, u.username, u.isActive)} style={{ fontSize: '0.75rem', marginRight: '0.75rem', border: 'none', background: 'none', cursor: 'pointer', color: u.isActive === "Y" ? '#d97706' : '#059669' }}>
                    {u.isActive === "Y" ? "Deactivate" : "Activate"}
                  </button>
                  <button onClick={() => deleteUser(u.userId, u.username)} style={{ color: '#dc2626', fontSize: '0.75rem', border: 'none', background: 'none', cursor: 'pointer' }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editingId !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={cancelEdit}>
          <div className="w-full max-w-md rounded-xl border bg-card p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Edit User</h3>
              <button onClick={cancelEdit} style={{ color: '#6b7280', fontSize: '1.25rem', lineHeight: '1', border: 'none', background: 'none', cursor: 'pointer' }}>&times;</button>
            </div>

            <div className="space-y-4">
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem', fontWeight: 500 }}>Display Name</label>
                <input value={editDisplayName} onChange={(e) => setEditDisplayName(e.target.value)} style={{ width: '100%', height: '2.25rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', padding: '0 0.75rem', fontSize: '0.875rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem', fontWeight: 500 }}>Email</label>
                <input value={editEmail} onChange={(e) => setEditEmail(e.target.value)} style={{ width: '100%', height: '2.25rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', padding: '0 0.75rem', fontSize: '0.875rem' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem', fontWeight: 500 }}>Role</label>
                <select value={String(editRoleId)} onChange={(e) => setEditRoleId(Number(e.target.value))} style={{ width: '100%', height: '2.25rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', padding: '0 0.75rem', fontSize: '0.875rem' }}>
                  {roles.map((r) => (
                    <option key={r.roleId} value={String(r.roleId)}>{r.roleName}</option>
                  ))}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '0.75rem', color: '#6b7280', marginBottom: '0.25rem', fontWeight: 500 }}>New Password <span style={{ color: '#9ca3af' }}>(leave blank to keep current)</span></label>
                <input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Min 6 characters" style={{ width: '100%', height: '2.25rem', borderRadius: '0.5rem', border: '1px solid #d1d5db', padding: '0 0.75rem', fontSize: '0.875rem' }} />
              </div>
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1.5rem' }}>
              <button onClick={cancelEdit} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.75rem', border: '1px solid #d1d5db', background: 'none', cursor: 'pointer' }}>Cancel</button>
              <button onClick={() => saveEdit(editingId)} disabled={saving} style={{ padding: '0.5rem 1rem', borderRadius: '0.5rem', fontSize: '0.75rem', border: 'none', background: '#2563eb', color: 'white', cursor: 'pointer' }}>
                {saving ? "Saving..." : "Save Changes"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
