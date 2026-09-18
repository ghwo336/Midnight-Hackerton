import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type {
  InvoiceRequest, InvoiceRequestQueue,
} from '../../application/ports/invoice-requests.js';

@Injectable()
export class InMemoryInvoiceRequests implements InvoiceRequestQueue {
  private readonly entries: InvoiceRequest[] = [];

  async submit(
    entry: Omit<InvoiceRequest, 'id' | 'status' | 'invoiceId' | 'requestedAt'>,
  ): Promise<InvoiceRequest> {
    const record: InvoiceRequest = {
      ...entry,
      id: randomUUID(),
      requestedAt: new Date().toISOString(),
      status: 'pending',
      invoiceId: null,
    };
    this.entries.unshift(record);
    return record;
  }

  async listFor(supplierId: string): Promise<readonly InvoiceRequest[]> {
    return this.entries.filter((entry) => entry.supplierId === supplierId);
  }

  async listPending(): Promise<readonly InvoiceRequest[]> {
    return this.entries.filter((entry) => entry.status === 'pending');
  }

  async find(id: string): Promise<InvoiceRequest | null> {
    return this.entries.find((entry) => entry.id === id) ?? null;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
