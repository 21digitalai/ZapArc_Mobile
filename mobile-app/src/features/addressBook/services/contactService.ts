/**
 * Contact Service
 * Handles CRUD operations for contacts
 */

import { generateUUID } from '../../../services/crypto';
import {
  Contact,
  CreateContactInput,
  UpdateContactInput,
  ValidationResult,
} from '../types';
import { loadContacts, saveContacts } from './contactStorage';
import {
  validateContactInput,
  normalizeLightningAddress,
} from './contactValidator';
import { contactDisplayName } from '../utils/contactDisplay';

/** Alphabetical comparison on the display label (name, or address fallback). */
function byDisplayName(a: Contact, b: Contact): number {
  return contactDisplayName(a).localeCompare(contactDisplayName(b));
}

/**
 * Get all contacts sorted by name
 */
export async function getAllContacts(): Promise<Contact[]> {
  const contacts = await loadContacts();
  return contacts.sort(byDisplayName);
}

/**
 * Get a contact by ID
 * Returns null if not found
 */
export async function getContactById(id: string): Promise<Contact | null> {
  const contacts = await loadContacts();
  return contacts.find((c) => c.id === id) ?? null;
}

/**
 * Search contacts by name or Lightning Address
 * Case-insensitive matching
 */
export async function searchContacts(query: string): Promise<Contact[]> {
  const contacts = await loadContacts();

  if (!query.trim()) {
    return contacts.sort(byDisplayName);
  }

  const normalizedQuery = query.trim().toLowerCase();

  const filtered = contacts.filter(
    (contact) =>
      contact.name.toLowerCase().includes(normalizedQuery) ||
      contact.lightningAddress.toLowerCase().includes(normalizedQuery) ||
      contact.sparkAddress?.toLowerCase().includes(normalizedQuery)
  );

  return filtered.sort(byDisplayName);
}

/**
 * Check if a Lightning Address already exists
 * Optionally exclude a contact ID (for updates)
 */
export async function addressExists(
  address: string,
  excludeId?: string
): Promise<boolean> {
  const contacts = await loadContacts();
  const normalizedAddress = normalizeLightningAddress(address);

  return contacts.some(
    (contact) =>
      normalizeLightningAddress(contact.lightningAddress) === normalizedAddress &&
      contact.id !== excludeId
  );
}

/**
 * Create a new contact
 * Validates input and checks for duplicates
 */
export async function createContact(
  input: CreateContactInput
): Promise<Contact> {
  // Validate input
  const validation = validateContactInput(input);
  if (!validation.isValid) {
    throw new ContactValidationError(validation);
  }

  // Check for duplicate address
  const isDuplicate = await addressExists(input.lightningAddress);
  if (isDuplicate) {
    throw new ContactValidationError({
      isValid: false,
      errors: [
        {
          field: 'lightningAddress',
          message: 'This Lightning Address is already saved in your address book',
        },
      ],
    });
  }

  const now = Date.now();
  const contact: Contact = {
    id: generateUUID(),
    name: input.name.trim(),
    lightningAddress: input.lightningAddress.trim(),
    sparkAddress: input.sparkAddress?.trim() || undefined,
    preferredAsset: input.preferredAsset,
    notes: input.notes?.trim() || undefined,
    createdAt: now,
    updatedAt: now,
  };

  // Load existing contacts and add new one
  const contacts = await loadContacts();
  contacts.push(contact);
  await saveContacts(contacts);

  return contact;
}

/**
 * Update an existing contact
 * Validates input and checks for duplicates
 */
export async function updateContact(
  input: UpdateContactInput
): Promise<Contact> {
  // Find existing contact
  const contacts = await loadContacts();
  const index = contacts.findIndex((c) => c.id === input.id);

  if (index === -1) {
    throw new ContactNotFoundError(input.id);
  }

  const existing = contacts[index];

  // Build update object with only provided fields
  const updateData: Partial<CreateContactInput> = {};
  if (input.name !== undefined) updateData.name = input.name;
  if (input.lightningAddress !== undefined)
    updateData.lightningAddress = input.lightningAddress;
  if (input.sparkAddress !== undefined)
    updateData.sparkAddress = input.sparkAddress;
  if (input.preferredAsset !== undefined)
    updateData.preferredAsset = input.preferredAsset;
  if (input.notes !== undefined) updateData.notes = input.notes;

  // Validate the update
  const validation = validateContactInput({
    ...existing,
    ...updateData,
  } as CreateContactInput);

  if (!validation.isValid) {
    throw new ContactValidationError(validation);
  }

  // Check for duplicate address (excluding current contact)
  if (input.lightningAddress !== undefined) {
    const isDuplicate = await addressExists(input.lightningAddress, input.id);
    if (isDuplicate) {
      throw new ContactValidationError({
        isValid: false,
        errors: [
          {
            field: 'lightningAddress',
            message: 'This Lightning Address is already saved in your address book',
          },
        ],
      });
    }
  }

  // Update the contact
  const updated: Contact = {
    ...existing,
    name: input.name !== undefined ? input.name.trim() : existing.name,
    lightningAddress:
      input.lightningAddress !== undefined
        ? input.lightningAddress.trim()
        : existing.lightningAddress,
    sparkAddress:
      input.sparkAddress !== undefined
        ? input.sparkAddress?.trim() || undefined
        : existing.sparkAddress,
    preferredAsset:
      input.preferredAsset !== undefined
        ? input.preferredAsset
        : existing.preferredAsset,
    notes:
      input.notes !== undefined
        ? input.notes?.trim() || undefined
        : existing.notes,
    updatedAt: Date.now(),
  };

  contacts[index] = updated;
  await saveContacts(contacts);

  return updated;
}

/**
 * Delete a contact by ID
 */
export async function deleteContact(id: string): Promise<void> {
  const contacts = await loadContacts();
  const index = contacts.findIndex((c) => c.id === id);

  if (index === -1) {
    throw new ContactNotFoundError(id);
  }

  contacts.splice(index, 1);
  await saveContacts(contacts);
}

/**
 * Merge a set of imported contacts (e.g. from a restored backup) into the
 * existing address book. The unique key is the NORMALISED lightning address —
 * an incoming contact whose address already exists is skipped (existing wins),
 * so re-importing is idempotent and never clobbers local edits. New contacts
 * get a fresh id + timestamps to avoid any collision with local ids.
 *
 * Returns how many were added vs. skipped.
 */
export async function mergeImportedContacts(
  incoming: Contact[]
): Promise<{ added: number; skipped: number }> {
  if (!Array.isArray(incoming) || incoming.length === 0) {
    return { added: 0, skipped: 0 };
  }

  const existing = await loadContacts();
  const seen = new Set(
    existing.map((c) => normalizeLightningAddress(c.lightningAddress))
  );

  let added = 0;
  let skipped = 0;
  const now = Date.now();

  for (const c of incoming) {
    const address = typeof c?.lightningAddress === 'string' ? c.lightningAddress.trim() : '';
    if (!address) {
      skipped++;
      continue;
    }
    const key = normalizeLightningAddress(address);
    if (seen.has(key)) {
      skipped++;
      continue;
    }
    seen.add(key);
    existing.push({
      id: generateUUID(),
      name: typeof c.name === 'string' ? c.name.trim() : '',
      lightningAddress: address,
      sparkAddress: c.sparkAddress?.trim() || undefined,
      preferredAsset: c.preferredAsset,
      notes: c.notes?.trim() || undefined,
      createdAt: typeof c.createdAt === 'number' ? c.createdAt : now,
      updatedAt: now,
    });
    added++;
  }

  if (added > 0) {
    await saveContacts(existing);
  }
  return { added, skipped };
}

/**
 * Custom error for validation failures
 */
export class ContactValidationError extends Error {
  public readonly validation: ValidationResult;

  constructor(validation: ValidationResult) {
    const message = validation.errors.map((e) => e.message).join(', ');
    super(message);
    this.name = 'ContactValidationError';
    this.validation = validation;
  }
}

/**
 * Custom error for contact not found
 */
export class ContactNotFoundError extends Error {
  public readonly contactId: string;

  constructor(contactId: string) {
    super(`Contact not found: ${contactId}`);
    this.name = 'ContactNotFoundError';
    this.contactId = contactId;
  }
}

export const contactService = {
  getAllContacts,
  getContactById,
  searchContacts,
  addressExists,
  createContact,
  updateContact,
  deleteContact,
  mergeImportedContacts,
};
