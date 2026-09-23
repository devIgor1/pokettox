// Quote all text and neutralize spreadsheet formula prefixes, including leading whitespace.
export function csvCell(value:string) { const safe=/^[\s]*[=+\-@\t\r\n]/.test(value)?`'${value}`:value;return `"${safe.replace(/"/g,'""')}"`; }
export function paidCsv(rows:Array<{name:string;phone:string;service:string}>) { return '\uFEFF'+[["Nome do cliente","Número de telefone","Modalidade escolhida","Status"],...rows.map(r=>[r.name,r.phone,r.service,"pago / pronto para envio"])].map(r=>r.map(csvCell).join(";")).join("\r\n"); }
