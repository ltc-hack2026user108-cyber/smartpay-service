import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { FirestoreProvider } from '../firestore/firestore.provider';
import { CreateOrderDto } from '../orders/dto/create-order.dto';
import { GculService } from '../orders/gcul.service';

@Injectable()
export class AdminService {
  private readonly collection = 'orders';
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly firestoreProvider: FirestoreProvider,
    private readonly gculService: GculService,
  ) {}

  async getDashboardDetails(): Promise<{
    totalBuyers: number;
    totalSellers: number;
    totalOrders: number;
    escrowBalance: number | null;
    settledAmount: number;
    refundAmount: number;
  }> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);

    const uniqueBuyers = new Set(orders.map((o) => o.buyer.id));
    const uniqueSellers = new Set(orders.map((o) => o.seller.id));

    // Fetch real escrow balance from GCUL ledger
    let escrowBalance: number | null = null;
    const escrowAccountId = process.env.GCUL_ESCROW_ACCOUNT_ID;
    if (escrowAccountId) {
      try {
        const balanceResult = await this.gculService.queryBalance(escrowAccountId);
        escrowBalance = balanceResult.balance;
      } catch (err: any) {
        this.logger.error(`Failed to fetch GCUL escrow balance: ${err.message}`);
      }
    }

    const settledAmount = orders
      .filter((o) => o.orderStatus === 'DELIVERED')
      .reduce((sum, o) => sum + o.amount, 0);

    const refundAmount = orders
      .filter((o) => o.orderStatus === 'REFUNDED')
      .reduce((sum, o) => sum + o.amount, 0);

    return {
      totalBuyers: uniqueBuyers.size,
      totalSellers: uniqueSellers.size,
      totalOrders: orders.length,
      escrowBalance,
      settledAmount,
      refundAmount,
    };
  }

  async getAccountDetail(userId: string): Promise<{
    id: string;
    name: string;
    role: string;
    balance: number;
    totalOrders: number;
  }> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();
    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);

    const buyerOrders = orders.filter((o) => o.buyer.id === userId);
    const sellerOrders = orders.filter((o) => o.seller.id === userId);

    if (!buyerOrders.length && !sellerOrders.length) {
      throw new NotFoundException(`No account found for userId ${userId}`);
    }

    if (buyerOrders.length) {
      const balance = buyerOrders
        .filter((o) => o.escrow?.status === 'LOCKED')
        .reduce((sum, o) => sum + (o.escrow?.lockedAmount || 0), 0);
      return {
        id: userId,
        name: buyerOrders[0].buyer.name,
        role: 'BUYER',
        balance,
        totalOrders: buyerOrders.length,
      };
    }

    const balance = sellerOrders
      .filter((o) => o.orderStatus === 'DELIVERED')
      .reduce((sum, o) => sum + o.amount, 0);

    return {
      id: userId,
      name: sellerOrders[0].seller.name,
      role: 'SELLER',
      balance,
      totalOrders: sellerOrders.length,
    };
  }

  async getAllOrderDetails(): Promise<{
    orderId: string;
    buyerName: string;
    sellerName: string;
    amount: number;
    status: string;
    escrowStatus: string;
    createdOn: string;
  }[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();

    if (snapshot.empty) {
      throw new NotFoundException('No orders found');
    }

    return snapshot.docs.map((doc) => {
      const o = doc.data() as CreateOrderDto;
      return {
        orderId: o._id,
        buyerName: o.buyer.name,
        sellerName: o.seller.name,
        amount: o.amount,
        status: o.orderStatus,
        escrowStatus: o.escrow?.status || 'N/A',
        createdOn: o.createdAt,
      };
    });
  }

  async getLedger(): Promise<{
    orderId: string;
    event: string;
    buyerHash: string;
    sellerHash: string;
    amount: number;
  }[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();

    if (snapshot.empty) {
      throw new NotFoundException('No orders found');
    }

    const ledger = [];
    snapshot.docs.forEach((doc) => {
      const o = doc.data() as CreateOrderDto;
      o.timeline
        .filter((t) => t.timestamp !== null)
        .forEach((t) => {
          ledger.push({
            orderId: o._id,
            event: t.label,
            buyerHash:o.buyer?.gculAccountId ,
            sellerHash:o.seller?.gculAccountId,
            amount: o.amount,
          });
        });
    });

    return ledger;
  }

  async getAllBuyers(): Promise<{ id: string; name: string; totalOrders: number; availableBalance: number | null }[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();

    if (snapshot.empty) {
      throw new NotFoundException('No orders found');
    }

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);

    // Build unique buyer map (order counts + gculAccountId from first order seen)
    const buyerMap = new Map<string, { id: string; name: string; totalOrders: number; gculAccountId: string | undefined }>();
    orders.forEach((o) => {
      if (buyerMap.has(o.buyer.id)) {
        buyerMap.get(o.buyer.id).totalOrders += 1;
      } else {
        buyerMap.set(o.buyer.id, {
          id: o.buyer.id,
          name: o.buyer.name,
          totalOrders: 1,
          gculAccountId: o.buyer?.gculAccountId,
        });
      }
    });

    // Fetch real GCUL balance per unique buyer
    const results = await Promise.all(
      Array.from(buyerMap.values()).map(async (buyer) => {
        let availableBalance: number | null = null;
        if (buyer.gculAccountId) {
          try {
            const balanceResult = await this.gculService.queryBalance(buyer.gculAccountId);
            availableBalance = balanceResult.balance;
          } catch (err: any) {
            this.logger.error(`Failed to fetch GCUL balance for buyer ${buyer.gculAccountId}: ${err.message}`);
          }
        }
        return { id: buyer.id, name: buyer.name, totalOrders: buyer.totalOrders, availableBalance };
      }),
    );

    return results;
  }

  async getAllSellers(): Promise<{ id: string; name: string; totalOrders: number; balance: number | null }[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();

    if (snapshot.empty) {
      throw new NotFoundException('No orders found');
    }

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);

    // Build unique seller map (order counts + gculAccountId from first order seen)
    const sellerMap = new Map<string, { id: string; name: string; totalOrders: number; gculAccountId: string | undefined }>();
    orders.forEach((o) => {
      if (sellerMap.has(o.seller.id)) {
        sellerMap.get(o.seller.id).totalOrders += 1;
      } else {
        sellerMap.set(o.seller.id, {
          id: o.seller.id,
          name: o.seller.name,
          totalOrders: 1,
          gculAccountId: o.seller?.gculAccountId,
        });
      }
    });

    // Fetch real GCUL balance per unique seller
    const results = await Promise.all(
      Array.from(sellerMap.values()).map(async (seller) => {
        let balance: number | null = null;
        if (seller.gculAccountId) {
          try {
            const balanceResult = await this.gculService.queryBalance(seller.gculAccountId);
            balance = balanceResult.balance;
          } catch (err: any) {
            this.logger.error(`Failed to fetch GCUL balance for seller ${seller.gculAccountId}: ${err.message}`);
          }
        }
        return { id: seller.id, name: seller.name, totalOrders: seller.totalOrders, balance };
      }),
    );

    return results;
  }
}
