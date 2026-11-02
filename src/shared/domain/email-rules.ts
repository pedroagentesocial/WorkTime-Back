// Dominios reservados para pruebas por el RFC 2606 y el 6761: no existen, un correo ahi solo rebota
const RESERVED_SUFFIXES = ['.test', '.example', '.invalid', '.localhost'];
const RESERVED_DOMAINS = ['example.com', 'example.net', 'example.org'];

export function isReservedEmailDomain(email: string): boolean {
  const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
  return (
    RESERVED_DOMAINS.some((reserved) => domain === reserved || domain.endsWith(`.${reserved}`)) ||
    RESERVED_SUFFIXES.some((suffix) => domain.endsWith(suffix) || domain === suffix.slice(1))
  );
}
