# Windows Credential Manager for NEXUS accounts (post-M7 Phase 14). Generic credentials, this Windows user only (DPAPI-protected
# by Windows). Usage: keyring.ps1 get|set|del <target>. The secret travels on stdin (set) / stdout (get), never on the command line.
param([Parameter(Mandatory)][ValidateSet('get', 'set', 'del')][string]$op, [Parameter(Mandatory)][string]$target)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System; using System.Runtime.InteropServices; using System.Text;
public static class NxCred {
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  struct CRED { public int Flags, Type; public string Target, Comment; public long Written; public int Size; public IntPtr Blob; public int Persist, AttrCount; public IntPtr Attrs; public string Alias, User; }
  [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredWriteW(ref CRED c, int f);
  [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredReadW(string t, int type, int f, out IntPtr c);
  [DllImport("advapi32", CharSet = CharSet.Unicode, SetLastError = true)] static extern bool CredDeleteW(string t, int type, int f);
  [DllImport("advapi32")] static extern void CredFree(IntPtr p);
  public static void Set(string t, string s) {
    byte[] b = Encoding.UTF8.GetBytes(s); var c = new CRED { Type = 1, Target = t, User = "NEXUS", Persist = 2, Size = b.Length, Blob = Marshal.AllocHGlobal(b.Length) };
    try { Marshal.Copy(b, 0, c.Blob, b.Length); if (!CredWriteW(ref c, 0)) throw new Exception("CredWrite " + Marshal.GetLastWin32Error()); } finally { Marshal.FreeHGlobal(c.Blob); }
  }
  public static string Get(string t) {
    IntPtr p; if (!CredReadW(t, 1, 0, out p)) return null;
    try { var c = (CRED)Marshal.PtrToStructure(p, typeof(CRED)); var b = new byte[c.Size]; Marshal.Copy(c.Blob, b, 0, c.Size); return Encoding.UTF8.GetString(b); } finally { CredFree(p); }
  }
  public static bool Del(string t) { return CredDeleteW(t, 1, 0); }
}
'@
if ($op -eq 'set') { $s = [Console]::In.ReadToEnd(); if (!$s) { exit 2 }; [NxCred]::Set($target, $s) }
elseif ($op -eq 'get') { $s = [NxCred]::Get($target); if ($null -eq $s) { exit 3 }; [Console]::Out.Write($s) }
else { if (![NxCred]::Del($target)) { exit 3 } }
