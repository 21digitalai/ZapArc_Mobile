/**
 * useContacts Hook
 *
 * Backed by a single module-level store so every screen shares ONE contacts
 * list. A create/update/delete from any screen notifies all `useContacts()`
 * consumers immediately — no per-instance copies that can go stale (e.g. the
 * Send screen still thinking a just-deleted contact exists).
 */

import { useCallback, useEffect } from 'react';
import {
  Contact,
  CreateContactInput,
  UpdateContactInput,
} from '../types';
import {
  getAllContacts,
  createContact as createContactService,
  updateContact as updateContactService,
  deleteContact as deleteContactService,
  ContactValidationError,
  ContactNotFoundError,
} from '../services/contactService';
import { createStore } from '../../../utils/createStore';

export interface UseContactsReturn {
  contacts: Contact[];
  loading: boolean;
  error: Error | null;
  createContact: (input: CreateContactInput) => Promise<Contact>;
  updateContact: (input: UpdateContactInput) => Promise<Contact>;
  deleteContact: (id: string) => Promise<void>;
  refreshContacts: () => Promise<void>;
}

// =============================================================================
// Module-level shared store
// =============================================================================

interface ContactsStoreState {
  contacts: Contact[];
  loading: boolean;
  error: Error | null;
}

const store = createStore<ContactsStoreState>({ contacts: [], loading: true, error: null });

/** Reload all contacts from storage into the shared store. */
export async function refreshContactsStore(): Promise<void> {
  try {
    store.setState({ loading: true, error: null });
    const loaded = await getAllContacts();
    store.setState({ contacts: loaded, loading: false });
  } catch (err) {
    console.error('❌ useContacts: Failed to load contacts', err);
    store.setState({
      error: err instanceof Error ? err : new Error('Failed to load contacts'),
      loading: false,
    });
  }
}

// Kick off the first load exactly once, when the first consumer mounts.
let initialLoadStarted = false;
function ensureInitialLoad(): void {
  if (initialLoadStarted) return;
  initialLoadStarted = true;
  void refreshContactsStore();
}

// =============================================================================
// Hook
// =============================================================================

export function useContacts(): UseContactsReturn {
  const state = store.useStore();

  useEffect(() => {
    ensureInitialLoad();
  }, []);

  const refreshContacts = useCallback(() => refreshContactsStore(), []);

  const createContact = useCallback(
    async (input: CreateContactInput): Promise<Contact> => {
      try {
        const newContact = await createContactService(input);
        await refreshContactsStore();
        return newContact;
      } catch (err) {
        if (err instanceof ContactValidationError) {
          throw err;
        }
        console.error('❌ useContacts: Failed to create contact', err);
        throw new Error('Failed to save contact. Please try again.');
      }
    },
    []
  );

  const updateContact = useCallback(
    async (input: UpdateContactInput): Promise<Contact> => {
      try {
        const updatedContact = await updateContactService(input);
        await refreshContactsStore();
        return updatedContact;
      } catch (err) {
        if (
          err instanceof ContactValidationError ||
          err instanceof ContactNotFoundError
        ) {
          throw err;
        }
        console.error('❌ useContacts: Failed to update contact', err);
        throw new Error('Failed to update contact. Please try again.');
      }
    },
    []
  );

  const deleteContact = useCallback(
    async (id: string): Promise<void> => {
      try {
        await deleteContactService(id);
        await refreshContactsStore();
      } catch (err) {
        if (err instanceof ContactNotFoundError) {
          throw err;
        }
        console.error('❌ useContacts: Failed to delete contact', err);
        throw new Error('Failed to delete contact. Please try again.');
      }
    },
    []
  );

  return {
    contacts: state.contacts,
    loading: state.loading,
    error: state.error,
    createContact,
    updateContact,
    deleteContact,
    refreshContacts,
  };
}
