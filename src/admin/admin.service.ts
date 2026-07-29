import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import { FirestoreProvider } from '../firestore/firestore.provider';
import { CreateOrderDto } from '../orders/dto/create-order.dto';

@Injectable()
export class AdminService {
  private readonly collection = 'orders';
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly firestoreProvider: FirestoreProvider) {}

  async getDashboardDetails(): Promise<{
    totalBuyers: number;
    totalSellers: number;
    totalOrders: number;
    escrowBalance: number;
    settledAmount: number;
    refundAmount: number;
  }> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);

    const uniqueBuyers = new Set(orders.map((o) => o.buyer.id));
    const uniqueSellers = new Set(orders.map((o) => o.seller.id));

    const escrowBalance = orders
      .filter((o) => o.escrow?.status === 'LOCKED')
      .reduce((sum, o) => sum + (o.escrow?.lockedAmount || 0), 0);

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
      const buyerHash = crypto.createHash('sha256').update(o.buyer.id).digest('hex').slice(0, 16);
      const sellerHash = crypto.createHash('sha256').update(o.seller.id).digest('hex').slice(0, 16);

      o.timeline
        .filter((t) => t.timestamp !== null)
        .forEach((t) => {
          ledger.push({
            orderId: o._id,
            event: t.label,
            buyerHash,
            sellerHash,
            amount: o.amount,
          });
        });
    });

    return ledger;
  }

  async getAllBuyers(): Promise<{ id: string; name: string; totalOrders: number; availableBalance: number }[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();

    if (snapshot.empty) {
      throw new NotFoundException('No orders found');
    }

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);
    const buyerMap = new Map<string, { id: string; name: string; totalOrders: number; availableBalance: number }>();

    orders.forEach((o) => {
      const activeStatuses = ['ORDER_CREATED', 'ACCEPTED', 'SHIPPED', 'IN_TRANSIT'];
      const lockedAmount = activeStatuses.includes(o.orderStatus) ? 0 : o.amount;

      if (buyerMap.has(o.buyer.id)) {
        const buyer = buyerMap.get(o.buyer.id);
        buyer.totalOrders += 1;
        buyer.availableBalance += lockedAmount;
      } else {
        buyerMap.set(o.buyer.id, { id: o.buyer.id, name: o.buyer.name, totalOrders: 1, availableBalance: lockedAmount });
      }
    });

    return Array.from(buyerMap.values());
  }

  async getAllSellers(): Promise<{ id: string; name: string; totalOrders: number; balance: number }[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();

    if (snapshot.empty) {
      throw new NotFoundException('No orders found');
    }

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);
    const sellerMap = new Map<string, { id: string; name: string; totalOrders: number; balance: number }>();

    orders.forEach((o) => {
      const earnedAmount = o.amount;

      if (sellerMap.has(o.seller.id)) {
        const seller = sellerMap.get(o.seller.id);
        seller.totalOrders += 1;
        seller.balance += earnedAmount;
      } else {
        sellerMap.set(o.seller.id, { id: o.seller.id, name: o.seller.name, totalOrders: 1, balance: earnedAmount });
      }
    });

    return Array.from(sellerMap.values());
  }
}
