import Dexie, { Table } from 'dexie';
import { IDBDomain, IDBForm, IDBField, IDBSetting } from '../types/schema';

export class LazarusDatabase extends Dexie {
  domains!: Table<IDBDomain, string>;
  forms!: Table<IDBForm, string>;
  fields!: Table<IDBField, string>;
  settings!: Table<IDBSetting, string>;

  constructor() {
    super('LazarusDatabase');

    this.version(1).stores({
      domains: 'id, domain, lastModified, status',
      forms: 'id, domainId, url, lastModified, status',
      fields: 'id, formId, domainId, name, type, lastModified, status',
      settings: 'key, lastModified',
    });

    this.version(2).stores({
      domains: 'id, domain, lastModified, status',
      forms:
        'id, domainId, formInstanceId, revisionId, url, lastModified, status, [domainId+lastModified], [domainId+formInstanceId+lastModified]',
      fields:
        'id, formId, domainId, revisionId, name, type, lastModified, status, [domainId+name+type]',
      settings: 'key, lastModified',
    });
  }
}

export const db = new LazarusDatabase();
