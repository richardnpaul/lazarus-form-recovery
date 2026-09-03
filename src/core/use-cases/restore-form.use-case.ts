import { IRestoreFormUseCase, RecoverableFieldSnippet } from '../ports/inbound/restore-form.port';
import { IFormRepositoryPort, FormWithFields, StoredFieldRecord } from '../ports/outbound/form-repository.port';
import { IVaultCryptoPort } from '../ports/outbound/vault-crypto.port';

export class RestoreFormUseCase implements IRestoreFormUseCase {
  constructor(
    private readonly repository: IFormRepositoryPort,
    private readonly vault: IVaultCryptoPort
  ) {}

  public async getRecoverableForm(formId: string): Promise<FormWithFields | undefined> {
    const form = await this.repository.getFormById(formId);
    if (!form || form.status !== 0) return undefined;

    let url = form.url;
    if (form.encryption === 'hybrid-aes-gcm') {
      try {
        url = await this.vault.decrypt(form.url, form.encryption);
      } catch {
        url = '[Encrypted URL]';
      }
    }

    const rawFields = await this.repository.getFieldsByFormId(formId);
    const decryptedFields: StoredFieldRecord[] = await Promise.all(
      rawFields
        .filter(f => f.status === 0)
        .map(async f => {
          let val = f.value;
          try {
            val = await this.vault.decrypt(f.value, f.encryption);
          } catch {
            val = '[Locked Draft - Enter Master Password]';
          }
          return {
            ...f,
            value: val,
          };
        })
    );

    return {
      form: {
        ...form,
        url,
      },
      fields: decryptedFields,
    };
  }

  public async getRecoverableText(domain: string, fieldName: string, fieldType: string): Promise<RecoverableFieldSnippet[]> {
    const rawFields = await this.repository.getRecoverableText(domain, fieldName, fieldType);

    const decrypted = await Promise.all(
      rawFields.map(async f => {
        let val = f.value;
        try {
          val = await this.vault.decrypt(f.value, f.encryption);
        } catch {
          val = '[Locked Draft - Enter Master Password]';
        }
        return {
          value: val,
          lastModified: f.lastModified,
        };
      })
    );

    // Deduplicate by text value, preserving newest
    const seen = new Set<string>();
    const unique: RecoverableFieldSnippet[] = [];

    for (const item of decrypted) {
      if (!seen.has(item.value)) {
        seen.add(item.value);
        unique.push(item);
      }
    }

    return unique.slice(0, 10);
  }
}
