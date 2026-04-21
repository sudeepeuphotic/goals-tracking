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

export default function AdminUsers() {
  const [users, setUsers] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", password: "", name: "", role: "contributor" });

  const load = async () => {
    const { data } = await api.get("/users");
    setUsers(data);
  };
  useEffect(() => { load(); }, []);

  const create = async () => {
    try {
      await api.post("/users", form);
      toast.success("User created");
      setOpen(false);
      setForm({ email: "", password: "", name: "", role: "contributor" });
      load();
    } catch (e) { toast.error(formatApiError(e)); }
  };

  return (
    <div className="p-6 md:p-8 max-w-[1100px] mx-auto">
      <div className="flex items-end justify-between mb-6">
        <div>
          <div className="mono-label">ADMIN · USERS</div>
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight mt-1">Team</h1>
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
                    {["admin", "manager", "dri", "contributor"].map(r => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter><Button className="rounded-none bg-black text-white" onClick={create} data-testid="u-save">Create</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="brutal-border border-b-0 border-r-0">
        {users.map(u => (
          <div key={u.id} className="grid grid-cols-[1fr_1fr_140px_160px] items-center p-4 brutal-border border-t-0 border-l-0 bg-white">
            <div className="font-medium">{u.name}</div>
            <div className="text-sm font-mono text-[var(--ink-soft)]">{u.email}</div>
            <div className="mono-label">{u.role}</div>
            <div className="text-xs font-mono text-[var(--ink-soft)]">{u.created_at?.slice(0,10)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
