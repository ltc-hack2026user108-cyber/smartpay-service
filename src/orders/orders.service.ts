import { Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { FirestoreProvider } from '../firestore/firestore.provider';
import { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  private readonly collection = 'orders';
  private readonly logger = new Logger(OrdersService.name);

  constructor(private readonly firestoreProvider: FirestoreProvider) {}

  async create(dto: CreateOrderDto): Promise<{ message: string; order: CreateOrderDto }> {
    const db = this.firestoreProvider.getDb();
    const docRef = db.collection(this.collection).doc(dto._id);

    const existing = await docRef.get();
    if (existing.exists) {
      throw new ConflictException(`Order ${dto._id} already exists`);
    }

    await docRef.set(dto);
    this.logger.log(`Order ${dto._id} saved to Firestore`);

    return { message: 'Order created successfully', order: dto };
  }

  async findAll(): Promise<CreateOrderDto[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).get();
    return snapshot.docs.map((doc) => doc.data() as CreateOrderDto);
  }

  async findOne(id: string): Promise<CreateOrderDto> {
    const db = this.firestoreProvider.getDb();
    const doc = await db.collection(this.collection).doc(id).get();
    if (!doc.exists) {
      throw new NotFoundException(`Order ${id} not found`);
    }
    return doc.data() as CreateOrderDto;
  }

  async findByBuyer(buyerId: string): Promise<CreateOrderDto[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).where('buyer.id', '==', buyerId).get();
    if (snapshot.empty) {
      throw new NotFoundException(`No orders found for buyer ${buyerId}`);
    }
    return snapshot.docs.map((doc) => doc.data() as CreateOrderDto);
  }

  async findBySeller(sellerId: string): Promise<CreateOrderDto[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).where('seller.id', '==', sellerId).get();
    if (snapshot.empty) {
      throw new NotFoundException(`No orders found for seller ${sellerId}`);
    }
    return snapshot.docs.map((doc) => doc.data() as CreateOrderDto);
  }

  async getBuyerDashboard(buyerId: string): Promise<{ activeOrders: number; deliveredOrders: number; incompleteOrders: number }> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).where('buyer.id', '==', buyerId).get();

    if (snapshot.empty) {
      throw new NotFoundException(`No orders found for buyer ${buyerId}`);
    }

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);

    const activeStatuses = ['ORDER_CREATED', 'ACCEPTED', 'SHIPPED', 'IN_TRANSIT'];
    const deliveredStatuses = ['DELIVERED'];
    const incompleteStatuses = ['REFUNDED','DECLINED', 'FAILED'];

    return {
      activeOrders: orders.filter((o) => activeStatuses.includes(o.orderStatus)).length,
      deliveredOrders: orders.filter((o) => deliveredStatuses.includes(o.orderStatus)).length,
      incompleteOrders: orders.filter((o) => incompleteStatuses.includes(o.orderStatus)).length,
    };
  }

  async updateOrderStatus(id: string, status: 'ACCEPTED' | 'DECLINED'): Promise<{ message: string; orderId: string; orderStatus: string }> {
    const db = this.firestoreProvider.getDb();
    const docRef = db.collection(this.collection).doc(id);

    const doc = await docRef.get();
    if (!doc.exists) {
      throw new NotFoundException(`Order ${id} not found`);
    }

    await docRef.update({ orderStatus: status, updatedAt: new Date().toISOString() });
    this.logger.log(`Order ${id} status updated to ${status}`);

    return { message: `Order ${status.toLowerCase()} successfully`, orderId: id, orderStatus: status };
  }
}
