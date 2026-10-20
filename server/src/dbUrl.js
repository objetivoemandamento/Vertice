function normalizeDatabaseUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return raw;
  const url = new URL(raw);
  // Repair the historical short Supabase host form observed in Render logs:
  // postgres.<project-ref> -> db.<project-ref>.supabase.co.
  // Only apply to a bare 20-character project ref; leave all other hosts untouched.
  const match = url.hostname.match(/^postgres\.([a-z0-9]{20})$/i);
  if (match) url.hostname = 'db.' + match[1] + '.supabase.co';
  return url.toString();
}

module.exports = { normalizeDatabaseUrl };
