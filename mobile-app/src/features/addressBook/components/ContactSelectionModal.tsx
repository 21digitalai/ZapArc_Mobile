/**
 * ContactSelectionModal Component
 * Modal for selecting a contact when sending payment
 */

import React from 'react';
import { StyleSheet, View, FlatList, TouchableOpacity } from 'react-native';
import { Modal, Portal, Text, IconButton, Avatar, Divider } from 'react-native-paper';
import { router } from 'expo-router';
import { Contact } from '../types';
import { ContactSearchBar } from './ContactSearchBar';
import { useContactSearch } from '../hooks/useContactSearch';
import { t } from '../../../services/i18nService';
import { BRAND_COLOR } from '../../../utils/theme-helpers';

type ContactAssetContext = 'BTC' | 'USDB';

interface ContactSelectionModalProps {
  visible: boolean;
  onDismiss: () => void;
  onSelect: (contact: Contact) => void;
  contacts: Contact[];
  /** Current user's Lightning Address to detect self */
  myAddress?: string;
  activeAsset?: ContactAssetContext;
}

export function ContactSelectionModal({
  visible,
  onDismiss,
  onSelect,
  contacts,
  myAddress,
  activeAsset = 'BTC',
}: ContactSelectionModalProps): React.JSX.Element {
  const assetContacts = React.useMemo(() => {
    if (activeAsset === 'USDB') {
      return contacts.filter((c) => !!c.sparkAddress?.trim());
    }
    return contacts.filter((c) => !!c.lightningAddress?.trim());
  }, [contacts, activeAsset]);

  const { searchQuery, setSearchQuery, filteredContacts } = useContactSearch(assetContacts);

  const handleSelect = (contact: Contact) => {
    onSelect(contact);
    setSearchQuery('');
    onDismiss();
  };

  /**
   * Dismiss the modal and route to the Add Contact screen. The Send
   * screen's useFocusEffect refreshes the contacts list on return, so
   * a freshly-added contact shows up for selection the next time the
   * user taps the contacts button.
   */
  const handleAddContact = () => {
    setSearchQuery('');
    onDismiss();
    router.push('/wallet/settings/address-book/add');
  };

  const renderContact = ({ item }: { item: Contact }) => {
    const initials = item.name
      .split(' ')
      .map((word) => word[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);

    const isSelf = myAddress ? item.lightningAddress.toLowerCase().trim() === myAddress.toLowerCase().trim() : false;

    return (
      <TouchableOpacity
        style={styles.contactItem}
        onPress={() => handleSelect(item)}
        activeOpacity={0.7}
      >
        <Avatar.Text
          size={40}
          label={initials}
          style={[styles.avatar, isSelf && styles.avatarSelf]}
          labelStyle={styles.avatarLabel}
        />
        <View style={styles.contactInfo}>
          <View style={styles.nameRow}>
            <Text style={styles.contactName}>{item.name}</Text>
            {isSelf && (
              <View style={styles.selfBadge}>
                <Text style={styles.selfBadgeText}>{t('addressBook.self')}</Text>
              </View>
            )}
          </View>
          <Text style={styles.contactAddress}>
            {activeAsset === 'USDB' ? item.sparkAddress : item.lightningAddress}
          </Text>
        </View>
      </TouchableOpacity>
    );
  };

  const renderSeparator = () => <Divider style={styles.divider} />;

  const renderEmpty = () => (
    <View style={styles.emptyContainer}>
      <Text style={styles.emptyText}>
        {searchQuery ? t('addressBook.noContactsFound') : t('addressBook.noContacts')}
      </Text>
    </View>
  );

  // Top-of-list "+ Add new contact" row, always visible. Survives whether
  // the list is empty, populated, or filtered. Tapping routes to the
  // Add Contact screen; upon return the Send screen refreshes contacts
  // and the new entry appears for selection.
  const renderAddContactRow = () => (
    <TouchableOpacity
      style={styles.addContactRow}
      onPress={handleAddContact}
      activeOpacity={0.7}
    >
      <View style={styles.addContactIcon}>
        <Text style={styles.addContactPlus}>+</Text>
      </View>
      <View style={styles.contactInfo}>
        <Text style={styles.addContactLabel}>{t('addressBook.addNew')}</Text>
        <Text style={styles.contactAddress}>
          {t('addressBook.addNewHint')}
        </Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <Portal>
      <Modal
        visible={visible}
        onDismiss={onDismiss}
        contentContainerStyle={styles.modalContent}
      >
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('addressBook.selectContact')}</Text>
          <IconButton
            icon="close"
            iconColor="#FFFFFF"
            size={24}
            onPress={onDismiss}
          />
        </View>

        <ContactSearchBar
          value={searchQuery}
          onChangeText={setSearchQuery}
          placeholder={t('addressBook.searchContacts')}
        />

        <FlatList
          data={filteredContacts}
          renderItem={renderContact}
          keyExtractor={(item) => item.id}
          ItemSeparatorComponent={renderSeparator}
          ListHeaderComponent={renderAddContactRow}
          ListEmptyComponent={renderEmpty}
          style={styles.list}
          contentContainerStyle={
            filteredContacts.length === 0 ? styles.emptyListContent : undefined
          }
        />
      </Modal>
    </Portal>
  );
}

const styles = StyleSheet.create({
  modalContent: {
    backgroundColor: '#1a1a2e',
    margin: 20,
    borderRadius: 16,
    minHeight: '50%',
    maxHeight: '80%',
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingLeft: 16,
    paddingRight: 4,
    paddingTop: 12,
    paddingBottom: 4,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FFFFFF',
  },
  list: {
    maxHeight: 400,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  contactItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
  },
  avatar: {
    backgroundColor: BRAND_COLOR,
  },
  avatarSelf: {
    backgroundColor: '#4CAF50',
  },
  avatarLabel: {
    color: '#000000',
    fontWeight: 'bold',
  },
  contactInfo: {
    marginLeft: 12,
    flex: 1,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  contactName: {
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  contactAddress: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.5)',
    marginTop: 2,
  },
  divider: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    marginLeft: 68,
  },
  emptyContainer: {
    padding: 32,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: 'rgba(255, 255, 255, 0.5)',
    textAlign: 'center',
  },
  addContactRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255, 255, 255, 0.08)',
  },
  addContactIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 193, 7, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(255, 193, 7, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  addContactPlus: {
    color: BRAND_COLOR,
    fontSize: 24,
    fontWeight: '500',
    lineHeight: 26,
  },
  addContactLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: BRAND_COLOR,
  },
  selfBadge: {
    backgroundColor: 'rgba(76, 175, 80, 0.2)',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: '#4CAF50',
  },
  selfBadgeText: {
    color: '#4CAF50',
    fontSize: 10,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
});
