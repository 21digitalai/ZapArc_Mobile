/**
 * Display helpers for contacts.
 *
 * The contact name is optional. When it's empty we fall back to the lightning
 * address everywhere a contact is shown, so a nameless contact still reads as
 * its address rather than a blank row.
 */
import type { Contact } from '../types';

/** The label to show for a contact: its name, or the lightning address. */
export function contactDisplayName(
  contact: Pick<Contact, 'name' | 'lightningAddress'>
): string {
  const name = contact.name?.trim();
  return name && name.length > 0 ? name : contact.lightningAddress;
}

/** Up-to-2-char initials derived from the display label (avatar circles). */
export function contactInitials(
  contact: Pick<Contact, 'name' | 'lightningAddress'>
): string {
  const label = contactDisplayName(contact).trim();
  if (!label) return '?';
  const initials = label
    .split(/\s+/)
    .map((word) => word[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .slice(0, 2);
  return initials || '?';
}
