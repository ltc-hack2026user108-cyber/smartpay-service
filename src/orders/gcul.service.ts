import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GculService {
  private readonly logger = new Logger(GculService.name);

  private get webhookUrl(): string {
    return process.env.GCUL_WEBHOOK_URL ?? 'http://localhost:8000/webhooks/contract/invoke';
  }

  private get ledgerServiceUrl(): string {
    return process.env.GCUL_LEDGER_SERVICE_URL ?? 'http://localhost:8000';
  }


  /**
   * Calls a method on the deployed SmartPayEscrow GCUL smart contract.
   * The GCUL runtime executes the method and performs the actual fund transfer on-chain.
   *
   * participant_account_id: the account signing/authorising this contract call.
   *   - create_order  → buyer (funds leave buyer's account)
   *   - order_delivered / order_failed → escrow (funds leave escrow account)
   */
  private async callContract(
    methodName: string,
    methodArgs: Record<string, string | number>,
    participantAccountId: string,
    logLabel: string,
  ): Promise<{ success: boolean; transactionHash: string }> {
    const payload = {
      contract_id: process.env.GCUL_CONTRACT_ID,
      participant_account_id: participantAccountId,
      method_name: methodName,
      method_args: methodArgs,
    };

    this.logger.log(`[GCUL] Calling '${methodName}' — ${logLabel}`);
    this.logger.debug(`[GCUL] Payload: ${JSON.stringify(payload)}`);

    try {
      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const result = await response.json();
      const txHash = result.transaction_digest ?? '';
      this.logger.log(`[GCUL] '${methodName}' succeeded. tx: ${txHash}`);
      return { success: true, transactionHash: txHash };
    } catch (error: any) {
      this.logger.error(`[GCUL] '${methodName}' failed: ${error.message}`);
      return { success: false, transactionHash: '' };
    }
  }

  /**
   * Helper to invoke direct ledger transfer via ledger_service.py /transfer endpoint.
   * This uses local keys/ in ledger_service.py to sign EC P-256 transaction and move real funds.
   */
  private async executeLedgerTransfer(
    fromAccountId: string,
    toAccountId: string,
    amount: number,
  ): Promise<{ success: boolean; transactionHash: string }> {
    const url = `${this.ledgerServiceUrl}/transfer`;
    this.logger.log(`[GCUL] Transferring ${amount} GBP from ${fromAccountId} -> ${toAccountId}`);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from_account_id: fromAccountId,
          to_account_id: toAccountId,
          amount,
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }

      const result = await response.json();
      const txHash = result.transaction_digest ?? '';
      this.logger.log(`[GCUL] Ledger Transfer succeeded. tx: ${txHash}`);
      return { success: true, transactionHash: txHash };
    } catch (error: any) {
      this.logger.error(`[GCUL] Ledger Transfer failed: ${error.message}`);
      return { success: false, transactionHash: '' };
    }
  }

  /**
   * createOrder: Buyer → Escrow payment.
   * Invokes contract create_order via webhook (which automatically transfers funds Buyer -> Escrow).
   */
  async createOrder(
    orderId: string,
    buyerAccountId: string,
    amount: number,
  ): Promise<{ success: boolean; transactionHash: string }> {
    return this.callContract(
      'create_order',
      { buyer: buyerAccountId, amount },
      buyerAccountId,
      `order ${orderId}, buyer ${buyerAccountId}, amount ${amount}`,
    );
  }

  /**
   * transferAmount: Escrow → Seller payment upon delivery.
   * Invokes contract order_delivered via webhook (which automatically transfers funds Escrow -> Seller).
   */
  async transferAmount(
    orderId: string,
    amount: number,
    seller: any,
  ): Promise<{ success: boolean; transactionHash: string }> {
    const sellerId: string = seller?.gculAccountId ?? process.env.GCUL_SELLER_ACCOUNT_ID ?? '';
    const escrowId: string = process.env.GCUL_ESCROW_ACCOUNT_ID ?? '';
    return this.callContract(
      'order_delivered',
      { seller: sellerId, amount },
      escrowId,
      `order ${orderId}, seller ${sellerId}, amount ${amount}`,
    );
  }

  /**
   * refundAmount: Escrow → Buyer refund upon failure/cancellation.
   * Invokes contract order_failed via webhook (which automatically transfers funds Escrow -> Buyer).
   */
  async refundAmount(
    orderId: string,
    amount: number,
    buyer: any,
  ): Promise<{ success: boolean; transactionHash: string }> {
    const buyerId: string = buyer?.gculAccountId?? process.env.GCUL_BUYER_ACCOUNT_ID ?? '';
    const escrowId: string = process.env.GCUL_ESCROW_ACCOUNT_ID ?? '';
    return this.callContract(
      'order_failed',
      { buyer: buyerId, amount },
      escrowId,
      `order ${orderId}, buyer ${buyerId}, amount ${amount}`,
    );
  }

  /**
   * Queries the GBP balance of a GCUL account.
   * Calls GET {GCUL_LEDGER_SERVICE_URL}/balance?account_id=<accountId>
   * on the running ledger_service.py Flask server.
   */
  async queryBalance(accountId: string): Promise<{ accountId: string; balance: number | null; raw: any }> {
    const url = `${this.ledgerServiceUrl}/balance?account_id=${encodeURIComponent(accountId)}`;
    this.logger.log(`[GCUL] Querying balance: GET ${url}`);

    try {
      const response = await fetch(url);
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`HTTP ${response.status}: ${text}`);
      }
      const data = await response.json();
      this.logger.log(`[GCUL] Balance for ${accountId}: ${data.balance}`);
      return { accountId, balance: data.balance ?? null, raw: data };
    } catch (error: any) {
      this.logger.error(`[GCUL] Balance query failed: ${error.message}`);
      throw error;
    }
  }
}
