"use client"

import React, { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/contexts/AuthContext'
import Loading from '@/components/Loading'
import { DatabaseService } from '@/lib/database'
import toast from 'react-hot-toast'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs } from '@/components/ui/tabs'
import { Dialog } from '@/components/ui/dialog'
import { TableWrapper, Table, THead, TBody, TR, TH, TD } from '@/components/ui/table'

type Role = {
  id: string
  name: string
  description?: string | null
  permissions?: Record<string, string[]>
}

type UserRow = {
  id: string
  email: string
  full_name?: string | null
  role_id?: string | null
  last_sign_in_at?: string | null
  status?: string | null
}

export default function RolesPermissions() {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<'users'|'roles'|'permissions'>('users')
  const [users, setUsers] = useState<UserRow[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [selectedRole, setSelectedRole] = useState<string | null>(null)
  const [editingRole, setEditingRole] = useState<string | null>(null)
  const [roleEditDraft, setRoleEditDraft] = useState<{name:string;description:string}>({name:'',description:''})
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)
  const [newRoleName, setNewRoleName] = useState('')
  const [newRoleDesc, setNewRoleDesc] = useState('')
  const [importJSON, setImportJSON] = useState('')
  const [exportData, setExportData] = useState<string | null>(null)
  const [tempGrant, setTempGrant] = useState({ hours: 24, resource: 'Invoices', action: 'Update' })
  const [allTempPerms, setAllTempPerms] = useState<any[]>([])
  const [attrEditor, setAttrEditor] = useState<{roleId:string; resource:string; json:string} | null>(null)
  const [overrideEditingUser, setOverrideEditingUser] = useState<string | null>(null)
  const [overrideTemp, setOverrideTemp] = useState<Record<string, string[]>>({})

  useEffect(() => {
    loadAll()
  }, [])

  const loadAll = async () => {
    setLoading(true)
    try {
      const [u, r, t] = await Promise.all([
        DatabaseService.getUsers(),
        DatabaseService.getRoles(),
        DatabaseService.getAllTemporaryPermissions?.() || Promise.resolve([])
      ])
      setUsers(u || [])
      setRoles(r || [])
      setAllTempPerms(t || [])
    } catch (e) {
      console.error(e)
      toast.error('Failed to load roles or users')
    } finally {
      setLoading(false)
    }
  }

  const changeUserRole = async (userId: string, roleId?: string | null) => {
    try {
      await DatabaseService.updateUserRole(userId, roleId || null)
      toast.success('Role updated')
      loadAll()
      // Audit log
      await DatabaseService.createAuditLog({ message: `${user?.email || 'System'} updated role for user ${userId} to ${roleId}`, created_by: user?.id || null })
    } catch (e) {
      console.error(e)
      toast.error('Failed to update role')
    }
  }

  const filteredUsers = useMemo(() => {
    if (!search) return users
    const q = search.toLowerCase()
    return users.filter(u => (u.email?.toLowerCase().includes(q) || (u.full_name || '').toLowerCase().includes(q)))
  }, [users, search])

  const createRole = async () => {
    if (!newRoleName.trim()) { toast.error('Role name required'); return }
    try {
      await DatabaseService.createRole({ name: newRoleName.trim(), description: newRoleDesc.trim() })
      toast.success('Role created')
      setNewRoleName(''); setNewRoleDesc(''); setCreating(false)
      loadAll()
    } catch (e) { console.error(e); toast.error('Create failed') }
  }

  const deleteRole = async (id: string) => {
    if (!confirm('Delete this role?')) return
    try { await DatabaseService.deleteRole(id); toast.success('Deleted'); if (selectedRole === id) setSelectedRole(null); loadAll() } catch (e) { console.error(e); toast.error('Delete failed') }
  }

  const beginEditRole = (r: any) => {
    setEditingRole(r.id)
    setRoleEditDraft({ name: r.name, description: r.description || '' })
  }

  const saveRoleEdit = async () => {
    if (!editingRole) return
    try {
      await DatabaseService.updateRole(editingRole, { name: roleEditDraft.name, description: roleEditDraft.description })
      toast.success('Role updated')
      setEditingRole(null)
      loadAll()
    } catch (e) { console.error(e); toast.error('Update failed') }
  }

  const openAttrEditor = (roleId: string, resource: string, existing?: any) => {
    setAttrEditor({ roleId, resource, json: JSON.stringify(existing || {}, null, 2) })
  }

  const saveAttrRule = async () => {
    if (!attrEditor) return
    try {
      let parsed: any = {}
      try { parsed = JSON.parse(attrEditor.json) } catch { toast.error('Invalid JSON'); return }
      await DatabaseService.updateRoleAttributePermission(attrEditor.roleId, attrEditor.resource, parsed)
      toast.success('Attribute rule saved')
      setAttrEditor(null)
      loadAll()
    } catch (e) { console.error(e); toast.error('Save failed') }
  }

  const revokeTemp = async (id: string) => {
    try { await DatabaseService.revokeTemporaryPermission(id); toast.success('Revoked'); loadAll() } catch (e) { console.error(e); toast.error('Revoke failed') }
  }

  const exportRoles = () => {
    setExportData(DatabaseService.exportRolesToJSON(roles))
  }

  const importRoles = async () => {
    try { await DatabaseService.importRolesFromJSON(importJSON); toast.success('Imported'); setImportJSON(''); loadAll() } catch (e:any) { toast.error(e.message || 'Import failed') }
  }

  const grantTemp = async (userId: string) => {
    try {
      await DatabaseService.grantTemporaryPermission(userId, tempGrant.resource, tempGrant.action, tempGrant.hours, user?.id)
      toast.success('Temporary permission granted')
      await DatabaseService.createAuditLog({ message: `${user?.email || 'System'} granted ${tempGrant.action} on ${tempGrant.resource} to user ${userId} for ${tempGrant.hours}h`, created_by: user?.id })
    } catch (e) { console.error(e); toast.error('Grant failed') }
  }

  const openOverrides = (u: UserRow) => {
    setOverrideEditingUser(u.id)
    // simplistic: pull from existing placeholder property if present
    setOverrideTemp((u as any).permission_overrides || {})
  }

  const saveOverrides = async () => {
    if (!overrideEditingUser) return
    try { await DatabaseService.updateUserOverrides(overrideEditingUser, overrideTemp); toast.success('Overrides saved'); setOverrideEditingUser(null); loadAll() } catch (e) { console.error(e); toast.error('Override save failed') }
  }

  if (!user) return <div className="p-6">Please sign in to manage roles.</div>
  if (loading) return <Loading />

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">Roles & Permissions</h3>
      </div>
      <Tabs value={activeTab} onValueChange={(v:any)=>setActiveTab(v)} tabs={[{value:'users',label:'Users'},{value:'roles',label:'Roles'},{value:'permissions',label:'Permissions'}]} />

      {activeTab === 'users' && (
        <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="text-sm text-gray-600 dark:text-gray-400">List of users & assignments. Search, grant temporary permissions, or edit overrides.</div>
              <div className="w-full sm:w-64"><Input placeholder="Search users..." value={search} onChange={e=>setSearch(e.target.value)} /></div>
            </div>
          <TableWrapper>
            <Table>
              <THead>
                <TR>
                  <TH>Name</TH>
                  <TH>Email</TH>
                  <TH>Role</TH>
                  <TH>Status</TH>
                  <TH>Last Login</TH>
                  <TH>Actions</TH>
                </TR>
              </THead>
              <TBody>
                {filteredUsers.map(u => (
                  <TR key={u.id}>
                    <TD>{u.full_name || '-'}</TD>
                    <TD className="font-mono text-xs">{u.email}</TD>
                    <TD>
                      <select value={u.role_id || ''} onChange={(e) => changeUserRole(u.id, e.target.value || null)} className="px-2 py-1 border rounded bg-transparent text-sm">
                        <option value="">-- No role --</option>
                        {roles.map(r => (<option key={r.id} value={r.id}>{r.name}</option>))}
                      </select>
                    </TD>
                    <TD>{u.status || 'active'}</TD>
                    <TD>{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleString() : '-'}</TD>
                    <TD className="space-x-2">
                      <Button variant="outline" size="sm" onClick={()=>grantTemp(u.id)}>Temp</Button>
                      <Button variant="outline" size="sm" onClick={()=>openOverrides(u)}>Overrides</Button>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </TableWrapper>
          {overrideEditingUser && (
            <div className="mt-4 p-4 border rounded bg-gray-50 dark:bg-gray-900">
              <h4 className="font-medium mb-2">Permission Overrides</h4>
              <p className="text-xs text-gray-500 mb-3">Add or remove user-specific actions (resource keyed). Simple JSON editor below.</p>
              <textarea rows={6} className="w-full text-xs font-mono border rounded p-2" value={JSON.stringify(overrideTemp, null, 2)} onChange={e=>{ try { setOverrideTemp(JSON.parse(e.target.value)) } catch { /* ignore */ } }} />
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={saveOverrides}>Save</Button>
                <Button size="sm" variant="outline" onClick={()=>setOverrideEditingUser(null)}>Cancel</Button>
              </div>
            </div>
          )}
          <div className="mt-4 p-3 border rounded flex flex-wrap gap-2 items-end">
            <div>
              <label className="block text-xs font-medium">Temp Resource</label>
              <select value={tempGrant.resource} onChange={e=>setTempGrant(g=>({...g, resource: e.target.value}))} className="text-sm border px-2 py-1 rounded">
                {['Products','Sales','Invoices','Payments','Reports','Settings'].map(r=> <option key={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Action</label>
              <select value={tempGrant.action} onChange={e=>setTempGrant(g=>({...g, action: e.target.value}))} className="text-sm border px-2 py-1 rounded">
                {['Create','Update','Delete','View','Export'].map(a=> <option key={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium">Hours</label>
              <input type="number" min={1} value={tempGrant.hours} onChange={e=>setTempGrant(g=>({...g, hours:Number(e.target.value)}))} className="text-sm border px-2 py-1 rounded w-20" />
            </div>
            <div className="text-xs text-gray-500">Use Temp on a user row to grant.</div>
          </div>
        </div>
      )}

      {activeTab === 'roles' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm text-gray-600 dark:text-gray-400">Create, edit, and delete roles. Click a role to view assigned users and permissions.</div>
            <div className="space-x-2">
              <Button variant="outline" size="sm" onClick={()=>setCreating(c=>!c)}>{creating? 'Close':'New Role'}</Button>
              <Button variant="outline" size="sm" onClick={exportRoles}>Export</Button>
            </div>
          </div>
          {creating && (
            <div className="mb-4 p-4 border rounded bg-gray-50 dark:bg-gray-900 space-y-2">
              <Input placeholder="Role name" value={newRoleName} onChange={e=>setNewRoleName(e.target.value)} />
              <textarea placeholder="Description" value={newRoleDesc} onChange={e=>setNewRoleDesc(e.target.value)} className="w-full border rounded px-2 py-1 text-sm" rows={2} />
              <Button size="sm" onClick={createRole}>Create</Button>
            </div>
          )}
          {exportData && (
            <div className="mb-4 p-3 border rounded bg-gray-50 dark:bg-gray-900">
              <div className="flex justify-between items-center mb-2"><span className="text-sm font-medium">Export JSON</span><button onClick={()=>setExportData(null)} className="text-xs border px-2 py-0.5 rounded">Close</button></div>
              <textarea readOnly rows={6} className="w-full text-xs font-mono border rounded p-2" value={exportData} />
            </div>
          )}
          <div className="mb-4 p-3 border rounded bg-gray-50 dark:bg-gray-900">
            <div className="text-xs font-medium mb-2">Import Roles JSON</div>
            <textarea rows={4} className="w-full text-xs font-mono border rounded p-2" value={importJSON} onChange={e=>setImportJSON(e.target.value)} />
            <div className="mt-2"><button onClick={importRoles} className="px-3 py-1 bg-green-600 text-white rounded text-sm">Import</button></div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-1">
              <div className="space-y-2">
                {roles.map(r => (
                  <div key={r.id} className={`p-3 border rounded group cursor-pointer ${selectedRole===r.id? 'bg-blue-50':'bg-white dark:bg-gray-900'}`} onClick={() => setSelectedRole(r.id)}>
                    <div className="flex justify-between items-start">
                      <div>
                        <div className="font-medium">{r.name}</div>
                        <div className="text-xs text-gray-500">{r.description}</div>
                      </div>
                      <button onClick={(e)=>{e.stopPropagation(); beginEditRole(r)}} className="opacity-60 group-hover:opacity-100 text-xs border rounded px-2 py-0.5">Edit</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="col-span-2">
              {selectedRole ? (
                <div>
                  <h4 className="font-semibold mb-2">Role Details</h4>
                  <div className="text-sm text-gray-600 mb-4">Users assigned to this role:</div>
                  <ul className="list-disc pl-5">
                    {users.filter(u => u.role_id === selectedRole).map(u => (<li key={u.id}>{u.email} {u.full_name? `(${u.full_name})` : ''}</li>))}
                  </ul>
                  <div className="mt-4 flex gap-3 flex-wrap"><Button variant="danger" size="sm" onClick={()=>deleteRole(selectedRole)}>Delete Role</Button></div>
                </div>
              ) : (
                <div className="text-sm text-gray-600">Select a role to view details or create a new role.</div>
              )}
            </div>
          </div>
          <Dialog open={!!editingRole} onOpenChange={(o)=>{ if(!o) setEditingRole(null) }} title="Edit Role" footer={
            <>
              <Button size="sm" onClick={saveRoleEdit}>Save</Button>
              <Button size="sm" variant="outline" onClick={()=>setEditingRole(null)}>Cancel</Button>
            </>
          }>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1">Name</label>
                <Input value={roleEditDraft.name} onChange={e=>setRoleEditDraft(d=>({...d,name:e.target.value}))} />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1">Description</label>
                <textarea value={roleEditDraft.description} onChange={e=>setRoleEditDraft(d=>({...d,description:e.target.value}))} className="w-full border rounded px-3 py-2 text-sm" rows={3} />
              </div>
            </div>
          </Dialog>
        </div>
      )}

      {activeTab === 'permissions' && (
        <div>
          <div className="mb-4 text-sm text-gray-600 dark:text-gray-400">Permission matrix per role. Toggle actions or add attribute rules (per resource).</div>
          <div className="space-y-6">
            {roles.map(r => (
              <div key={r.id} className="border rounded-lg overflow-hidden">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-2 px-4 py-3 bg-gray-50 dark:bg-gray-900 border-b">
                  <div>
                    <div className="font-medium">{r.name}</div>
                    {r.description && <div className="text-xs text-gray-500">{r.description}</div>}
                  </div>
                  <div className="flex gap-2"></div>
                </div>
                <div className="p-4">
                  <div className="text-xs font-medium mb-2 text-gray-600">Permissions</div>
                  <div className="grid gap-4 md:gap-6 md:grid-cols-3 lg:grid-cols-6">
                    {['Products','Sales','Invoices','Payments','Reports','Settings'].map(resource => (
                      <div key={resource} className="rounded border p-2 bg-white dark:bg-gray-800">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-semibold tracking-wide">{resource}</span>
                          <Button variant="outline" size="sm" className="!h-6 !px-2 text-[10px]" onClick={()=>openAttrEditor(r.id, resource, (r as any).permissions_attributes?.[resource])}>Attr</Button>
                        </div>
                        <div className="space-y-1">
                          {['Create','Update','Delete','View','Export'].map(action => {
                            const checked = !!(r.permissions && r.permissions[resource] && r.permissions[resource].includes(action))
                            return (
                              <label key={action} className="flex items-center gap-2 text-[11px] font-medium">
                                <Checkbox defaultChecked={checked} onChange={async (e)=>{
                                  const enabled = (e.target as HTMLInputElement).checked
                                  try {
                                    await DatabaseService.toggleRolePermission(r.id, resource, action, enabled)
                                    toast.success('Permission updated')
                                    await DatabaseService.createAuditLog({ message: `${user?.email || 'System'} ${enabled? 'granted' : 'revoked'} ${action} on ${resource} for role ${r.name}`, created_by: user?.id || null })
                                  } catch (err) {
                                    console.error(err)
                                    toast.error('Failed')
                                  }
                                }} />
                                {action}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>
          {attrEditor && (
            <Dialog open={!!attrEditor} onOpenChange={(o)=>{ if(!o) setAttrEditor(null) }} title={`Attribute Rule: ${attrEditor.resource}`} footer={
              <>
                <Button size="sm" onClick={saveAttrRule}>Save</Button>
                <Button size="sm" variant="outline" onClick={()=>setAttrEditor(null)}>Cancel</Button>
              </>
            }>
              <div className="space-y-2">
                <p className="text-xs text-gray-500">Define constraints (e.g. {`{"scope":"own"}`} or {`{"branch":"Bangalore"}`}).</p>
                <textarea rows={8} className="w-full text-xs font-mono border rounded p-2" value={attrEditor.json} onChange={e=>setAttrEditor(a=>a && ({...a,json:e.target.value}))} />
              </div>
            </Dialog>
          )}
        </div>
      )}
      <div className="mt-10">
        <h4 className="font-semibold mb-2">Active Temporary Permissions</h4>
        <TableWrapper>
          <Table>
            <THead>
              <TR>
                <TH>User</TH>
                <TH>Resource</TH>
                <TH>Action</TH>
                <TH>Expires</TH>
                <TH>Granted By</TH>
                <TH>Actions</TH>
              </TR>
            </THead>
            <TBody>
              {allTempPerms.map(t => {
                const usr = users.find(u=>u.id===t.user_id)
                return (
                  <TR key={t.id}>
                    <TD className="font-mono text-xs">{usr?.email || t.user_id}</TD>
                    <TD>{t.resource}</TD>
                    <TD>{t.action}</TD>
                    <TD>{new Date(t.expires_at).toLocaleString()}</TD>
                    <TD>{t.granted_by || '-'}</TD>
                    <TD><Button variant="outline" size="sm" onClick={()=>revokeTemp(t.id)}>Revoke</Button></TD>
                  </TR>
                )})}
              {allTempPerms.length===0 && (
                <TR><TD colSpan={6} className="p-3 text-center text-xs text-gray-500">No active temporary permissions</TD></TR>
              )}
            </TBody>
          </Table>
        </TableWrapper>
      </div>
    </div>
  )
}
