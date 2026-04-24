import { useEffect, useState } from "react";
import { api, formatApiError } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ROLE } from "@/lib/roles";
import { asArray } from "@/lib/safe";

export default function AdminUsers() {
  const fallbackRoles = [ROLE.ADMIN, ROLE.MANAGER, ROLE.DRI, ROLE.CONTRIBUTOR];
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState(fallbackRoles);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: ROLE.CONTRIBUTOR });

  const load = async () => {
    const [usersRes, rolesRes] = await Promise.all([
      api.get("/users"),
      api.get("/auth/roles").catch(() => ({ data: { roles: fallbackRoles } })),
    ]);
    setUsers(asArray(usersRes.data));
    const serverRoles = rolesRes?.data?.roles;
    setRoles(Array.isArray(serverRoles) && serverRoles.length > 0 ? serverRoles : fallbackRoles);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    try {
      await api.post("/users", form);
      toast.success("User created");
      setOpen(false);
      setForm({ email: "", password: "", name: "", role: ROLE.CONTRIBUTOR });
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const updateManager = async (userId, managerId) => {
    try {
      if (managerId === "__none__") {
        await api.patch(`/users/${userId}`, { clear_manager: true });
      } else {
        await api.patch(`/users/${userId}`, { manager_id: managerId });
      }
      toast.success("Manager updated");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const updateRole = async (userId, role) => {
    try {
      await api.patch(`/users/${userId}`, { role });
      toast.success("Role updated");
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  const nameFor = (id) => users.find(u => u.id === id)?.name || "—";

  return (
    <div className="p-6 md:p-8 max-w-[1200px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="mono-label">ADMIN · USERS & HIERARCHY</div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Team</h1>
          <p className="text-[var(--ink-soft)] mt-2 text-sm">
            Assign a manager to each user. Managers can edit plans, submit weekly updates, and create tasks for anyone in their downline.
          </p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="rounded-none bg-black text-white brutal-shadow-sm" data-testid="new-user-btn">+ New user</Button>
          </DialogTrigger>
          <DialogContent className="rounded-none border border-black">
            <DialogHeader><DialogTitle>New User</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Name</Label><Input className="rounded-none border-black mt-1" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} data-testid="u-name" /></div>
              <div><Label>Email</Label><Input className="rounded-none border-black mt-1" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} data-testid="u-email" /></div>
              <div><Label>Password</Label><Input className="rounded-none border-black mt-1" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} data-testid="u-password" /></div>
              <div>
                <Label>Role</Label>
                <Select value={form.role} onValueChange={v => setForm({ ...form, role: v })}>
                  <SelectTrigger className="rounded-none border-black mt-1" data-testid="u-role"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button className="rounded-none bg-black text-white" onClick={create} data-testid="u-save">Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="brutal-border border-b-0 border-r-0">
        <div className="grid grid-cols-[1.2fr_1.4fr_140px_1.2fr] p-3 brutal-border border-t-0 border-l-0 bg-[var(--surface-hover)]">
          <div className="mono-label">NAME</div>
          <div className="mono-label">EMAIL</div>
          <div className="mono-label">ROLE</div>
          <div className="mono-label">REPORTS TO</div>
        </div>
        {users.map(u => (
          <div key={u.id} className="grid grid-cols-[1.2fr_1.4fr_140px_1.2fr] items-center p-3 brutal-border border-t-0 border-l-0 bg-white" data-testid={`user-row-${u.id}`}>
            <div>
              <div className="font-medium">{u.name}</div>
              <div className="text-xs font-mono text-[var(--ink-soft)]">Reports up → {nameFor(u.manager_id)}</div>
            </div>
            <div className="text-sm font-mono text-[var(--ink-soft)] truncate">{u.email}</div>
            <div>
              <Select value={u.role} onValueChange={v => updateRole(u.id, v)}>
                <SelectTrigger className="rounded-none border-black h-8 text-xs" data-testid={`role-${u.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {roles.map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Select value={u.manager_id || "__none__"} onValueChange={v => updateManager(u.id, v)}>
                <SelectTrigger className="rounded-none border-black h-8 text-xs" data-testid={`manager-${u.id}`}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">— no manager —</SelectItem>
                  {users.filter(other => other.id !== u.id).map(other =>
                    <SelectItem key={other.id} value={other.id}>{other.name} · {other.role}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
