import { Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import { FirestoreProvider } from '../firestore/firestore.provider';
import { CreateOrderDto, OrderStatus } from './dto/create-order.dto';
import { ShippoService } from './shippo.service';
import { GculService } from './gcul.service';
@Injectable()
export class OrdersService {
  private readonly collection = 'orders';
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly firestoreProvider: FirestoreProvider,
    private readonly shippoService: ShippoService,
    private readonly gculService: GculService,
  ) {}
 async create(dto: CreateOrderDto): Promise<{ message: string; order: CreateOrderDto }> {
    const db = this.firestoreProvider.getDb();
    const docRef = db.collection(this.collection).doc(dto._id);

    const existing = await docRef.get();
    if (existing.exists) {
      throw new ConflictException(`Order ${dto._id} already exists`);
    }

    // 1. Build and save the order (no Shippo tracker yet — created on ACCEPTED)
    const createdTimestamp = new Date().toISOString();
    const orderData: CreateOrderDto = {
      ...dto,
      orderStatus: OrderStatus.CREATED,
      timeline: [
        ...(dto.timeline || []),
        {
          status: OrderStatus.CREATED,
          label: this.getStatusLabel(OrderStatus.CREATED),
          timestamp: createdTimestamp,
        },
      ],
      createdAt: dto.createdAt || createdTimestamp,
      updatedAt: createdTimestamp,
    };

    await docRef.set(orderData);
    this.logger.log(`Order ${dto._id} saved to Firestore`);

    // 2. Trigger GCUL smart contract createOrder (Buyer -> Escrow transfer)
    try {
      const buyerAccountId: string = dto.buyer?.gculAccountId ?? process.env.GCUL_BUYER_ACCOUNT_ID ?? '';
      if (buyerAccountId) {
        await this.gculService.createOrder(dto._id, buyerAccountId, dto.amount);
      }
    } catch (gculError: any) {
      this.logger.error(`GCUL createOrder failed for order ${dto._id}: ${gculError.message}`);
    }

    // 3. Retrieve and return the saved order
    const updatedDoc = await docRef.get();
    const finalOrder = updatedDoc.data() as CreateOrderDto;

    return { message: 'Order created successfully', order: finalOrder };
  }

  async handleShippoWebhook(payload: any): Promise<{ success: boolean }> {
    this.logger.log(`Received Shippo Webhook payload: ${JSON.stringify(payload)}`);

    const trackerId = payload?.data?.id || payload?.data?.object_id;
    const shippoStatus = payload?.data?.status;
    const trackingNumber = payload?.data?.tracking_number;

    if (!trackerId || !shippoStatus) {
      this.logger.warn('Shippo webhook payload is missing tracker ID or status');
      return { success: false };
    }

    const db = this.firestoreProvider.getDb();
    let orderDoc: FirebaseFirestore.DocumentSnapshot<FirebaseFirestore.DocumentData> | null = null;
    let orderId: string | null = null;

    // Check if the tracking number follows our custom pattern to extract the order ID directly
    if (trackingNumber) {
      const match = trackingNumber.match(/SHIPPO_[A-Z_]+_ORDER_(.+)(0\d)$/);
      if (match) {
        orderId = match[1];
        const docRef = db.collection(this.collection).doc(orderId);
        const doc = await docRef.get();
        if (doc.exists) {
          orderDoc = doc;
        }
      }
    }

    // Fallback: lookup by nested tracker ID if orderId direct lookup wasn't possible
    if (!orderDoc) {
      const snapshot = await db.collection(this.collection).where('shippoDetails.trackerId', '==', trackerId).get();
      if (!snapshot.empty) {
        orderDoc = snapshot.docs[0];
      }
    }

    if (!orderDoc) {
      this.logger.warn(`No order found matching Shippo tracker ID: ${trackerId} or tracking number: ${trackingNumber}`);
      return { success: false };
    }

    const order = orderDoc.data() as CreateOrderDto;
    const nextStatus = this.mapShippoStatusToOrderStatus(shippoStatus);

    if (order.orderStatus !== nextStatus) {
      const timeline = order.timeline || [];
      timeline.push({
        status: nextStatus,
        label: this.getStatusLabel(nextStatus),
        timestamp: new Date().toISOString(),
      });

      await orderDoc.ref.update({
        orderStatus: nextStatus,
        timeline,
        updatedAt: new Date().toISOString(),
      });

      this.logger.log(`Order ${order._id} status updated to ${nextStatus}`);

      // Trigger GCUL smart contracts for final statuses
      if (nextStatus === OrderStatus.DELIVERED) {
        try {
          await this.gculService.transferAmount(order._id, order.amount, order.seller);
        } catch (err: any) {
          this.logger.error(`GCUL transferAmount failed for order ${order._id}: ${err.message}`);
        }
      } else if (nextStatus === OrderStatus.FAILED) {
        try {
          await this.gculService.refundAmount(order._id, order.amount, order.buyer);
        } catch (err: any) {
          this.logger.error(`GCUL refundAmount failed for order ${order._id}: ${err.message}`);
        }
        
        // Transition to REFUNDED status in DB and timeline after refund contract runs
        const updatedTimeline = [...timeline, {
          status: OrderStatus.REFUNDED,
          label: this.getStatusLabel(OrderStatus.REFUNDED),
          timestamp: new Date().toISOString(),
        }];
        await orderDoc.ref.set({
          orderStatus: OrderStatus.REFUNDED,
          timeline: updatedTimeline,
          updatedAt: new Date().toISOString(),
        }, { merge: true });
        this.logger.log(`Order ${order._id} status updated to ${OrderStatus.REFUNDED} after refund contract call.`);
      }
    }

    return { success: true };
  }

  async simulateStatus(orderId: string, status: string): Promise<CreateOrderDto> {
    const db = this.firestoreProvider.getDb();
    const docRef = db.collection(this.collection).doc(orderId);
    const doc = await docRef.get();

    if (!doc.exists) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }

    const order = doc.data() as CreateOrderDto;

    // Final state check: if order is already DELIVERED, REFUNDED, FAILED, or DECLINED, skip simulation and return directly
    const finalStatuses: string[] = [OrderStatus.DELIVERED, OrderStatus.REFUNDED, OrderStatus.FAILED, OrderStatus.DECLINED];
    if (finalStatuses.includes(order.orderStatus)) {
      this.logger.log(`Order ${orderId} is already in final state '${order.orderStatus}'. Returning order directly.`);
      return order;
    }

    // 1. Determine tracking number and status based on simulation request
    let shippoStatus = 'UNKNOWN';
    let targetTrackingNumber = 'SHIPPO_TRANSIT';
    const s = status.toLowerCase();

    if (s === 'shipped') {
      shippoStatus = 'SHIPPED';
      targetTrackingNumber = 'SHIPPO_TRANSIT';
    } else if (s === 'intransit' || s === 'in_transit') {
      shippoStatus = 'TRANSIT';
      targetTrackingNumber = 'SHIPPO_TRANSIT';
    } else if (s === 'delivered') {
      shippoStatus = 'DELIVERED';
      targetTrackingNumber = 'SHIPPO_DELIVERED';
    } else if (s === 'failed' || s === 'failure' || s === 'refunded') {
      shippoStatus = 'FAILURE';
      targetTrackingNumber = 'SHIPPO_FAILURE';
    }

    // 2. Call Shippo API to register the tracker (so real Shippo has it registered in test mode)
    const tracker = await this.shippoService.createTracker(targetTrackingNumber, 'shippo');

    // 3. Update local Firestore order fields to match this new tracker registered at Shippo
    await docRef.update({
      shippoDetails: {
        trackerId: tracker.id,
        trackingCode: tracker.trackingNumber,
        carrier: tracker.carrier,
      }
    });

    // 4. Trigger simulated webhook execution to update local DB status immediately
    await this.handleShippoWebhook({
      event: 'track_updated',
      data: {
        id: tracker.id,
        tracking_number: tracker.trackingNumber,
        carrier: tracker.carrier,
        status: shippoStatus,
        tracking_status: {
          status: shippoStatus,
          status_details: 'Simulated status update via test code prefix',
        },
      },
    });

    const updatedDoc = await docRef.get();
    return updatedDoc.data() as CreateOrderDto;
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

  async getBuyerDashboard(buyerId: string): Promise<{ activeOrders: number; deliveredOrders: number; incompleteOrders: number; availableBalance: number | null }> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).where('buyer.id', '==', buyerId).get();
    console.log('snapshot empty', snapshot);
    if (snapshot.empty) {
      throw new NotFoundException(`No orders found for buyer ${buyerId}`);
    }

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);
    console.log('orders', orders);
    const activeStatuses = ['ORDER_CREATED', 'ACCEPTED', 'SHIPPED', 'IN_TRANSIT'];
    const deliveredStatuses = ['DELIVERED'];
    const incompleteStatuses = ['REFUNDED', 'DECLINED', 'FAILED'];

    // Fetch real GCUL balance for the buyer
    let availableBalance: number | null = null;
    const firstOrder = orders[0];
    const gculAccountId = firstOrder?.buyer?.gculAccountId;
    if (gculAccountId) {
      try {
        const balanceResult = await this.gculService.queryBalance(gculAccountId);
        availableBalance = balanceResult.balance;
      } catch (err: any) {
        this.logger.error(`Failed to fetch GCUL balance for buyer ${gculAccountId}: ${err.message}`);
      }
    }

    return {
      activeOrders: orders.filter((o) => activeStatuses.includes(o.orderStatus)).length,
      deliveredOrders: orders.filter((o) => deliveredStatuses.includes(o.orderStatus)).length,
      incompleteOrders: orders.filter((o) => incompleteStatuses.includes(o.orderStatus)).length,
      availableBalance,
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

    if (status === 'ACCEPTED') {
      // Create Shippo tracker and fire SHIPPED webhook now that seller has accepted
      try {
        const tracker = await this.shippoService.createTracker('SHIPPO_TRANSIT', 'shippo');
        await docRef.update({
          shippoDetails: {
            trackerId: tracker.id,
            trackingCode: tracker.trackingNumber,
            carrier: tracker.carrier,
          },
          updatedAt: new Date().toISOString(),
        });
        this.logger.log(`Order ${id} Shippo tracker created: ${tracker.id}`);

        await this.handleShippoWebhook({
          event: 'track_updated',
          data: {
            id: tracker.id,
            tracking_number: tracker.trackingNumber,
            carrier: tracker.carrier,
            status: 'SHIPPED',
            tracking_status: {
              status: 'SHIPPED',
              status_details: 'Package received by carrier / shipped',
            },
          },
        });
      } catch (shippoError: any) {
        this.logger.error(`Shippo tracker creation failed for accepted order ${id}: ${shippoError.message}`);
      }
    }

    if (status === 'DECLINED') {
      const order = doc.data() as CreateOrderDto;
      const now = new Date().toISOString();
      const updatedTimeline = [
        ...(order.timeline || []),
        {
          status: OrderStatus.DECLINED,
          label: this.getStatusLabel(OrderStatus.DECLINED),
          timestamp: now,
        },
      ];

      // Update timeline with DECLINED first
      await docRef.update({ timeline: updatedTimeline, updatedAt: now });

      // Trigger GCUL refund
      try {
        await this.gculService.refundAmount(order._id, order.amount, order.buyer);
      } catch (err: any) {
        this.logger.error(`GCUL refundAmount failed for declined order ${id}: ${err.message}`);
      }

      // Append REFUNDED to timeline and set final status
      const refundedTimeline = [
        ...updatedTimeline,
        {
          status: OrderStatus.REFUNDED,
          label: this.getStatusLabel(OrderStatus.REFUNDED),
          timestamp: new Date().toISOString(),
        },
      ];
      await docRef.set(
        { orderStatus: OrderStatus.REFUNDED, timeline: refundedTimeline, updatedAt: new Date().toISOString() },
        { merge: true },
      );
      this.logger.log(`Order ${id} timeline updated with DECLINED and REFUNDED`);
    }

    return { message: `Order ${status.toLowerCase()} successfully`, orderId: id, orderStatus: status };
  }

  async getSellerDashboard(sellerId: string): Promise<{ pendingOrders: number; acceptedOrders: number; inTransitOrders: number; amountReceived: number }> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection).where('seller.id', '==', sellerId).get();

    if (snapshot.empty) {
      throw new NotFoundException(`No orders found for seller ${sellerId}`);
    }

    const orders = snapshot.docs.map((doc) => doc.data() as CreateOrderDto);

    return {
      pendingOrders: orders.filter((o) => o.orderStatus === 'CREATED').length,
      acceptedOrders: orders.filter((o) => o.orderStatus === 'ACCEPTED').length,
      inTransitOrders: orders.filter((o) => o.orderStatus === 'IN_TRANSIT').length,
      amountReceived: orders
        .filter((o) => o.orderStatus === 'DELIVERED')
        .reduce((sum, o) => sum + o.amount, 0),
    };
  }

  async getPendingOrders(sellerId: string): Promise<{ orderId: string; buyerName: string; description: string; amount: number; deliveryDate: string }[]> {
    const db = this.firestoreProvider.getDb();
    const snapshot = await db.collection(this.collection)
      .where('seller.id', '==', sellerId)
      .where('orderStatus', '==', 'ORDER_CREATED')
      .get();

    if (snapshot.empty) {
      throw new NotFoundException(`No pending orders found for seller ${sellerId}`);
    }

    return snapshot.docs.map((doc) => {
      const o = doc.data() as CreateOrderDto;
      return {
        orderId: o._id,
        buyerName: o.buyer.name,
        description: o.description,
        amount: o.amount,
        deliveryDate: o.deliveryDate,
      };
    });
  }

  async getAcceptedOrders(sellerId: string): Promise<{ orderId: string; buyerName: string; description: string; amount: number; deliveryDate: string; status: string }[]> {
    const db = this.firestoreProvider.getDb();
    const activeStatuses = ['ACCEPTED', 'SHIPPED', 'IN_TRANSIT'];

    const snapshots = await Promise.all(
      activeStatuses.map((status) =>
        db.collection(this.collection)
          .where('seller.id', '==', sellerId)
          .where('orderStatus', '==', status)
          .get()
      )
    );

    const orders = snapshots.flatMap((snapshot) =>
      snapshot.docs.map((doc) => doc.data() as CreateOrderDto)
    );

    if (!orders.length) {
      throw new NotFoundException(`No accepted orders found for seller ${sellerId}`);
    }

    return orders.map((o) => ({
      orderId: o._id,
      buyerName: o.buyer.name,
      description: o.description,
      amount: o.amount,
      deliveryDate: o.deliveryDate,
      status: o.orderStatus,
    }));
  }

  async getOrderHistory(sellerId: string): Promise<{ orderId: string; buyerName: string; description: string; amount: number; deliveryDate: string; status: string }[]> {
    const db = this.firestoreProvider.getDb();
    const historyStatuses = ['DELIVERED', 'FAILED', 'REFUNDED', 'DECLINED'];

    const snapshots = await Promise.all(
      historyStatuses.map((status) =>
        db.collection(this.collection)
          .where('seller.id', '==', sellerId)
          .where('orderStatus', '==', status)
          .get()
      )
    );

    const orders = snapshots.flatMap((snapshot) =>
      snapshot.docs.map((doc) => doc.data() as CreateOrderDto)
    );

    if (!orders.length) {
      throw new NotFoundException(`No order history found for seller ${sellerId}`);
    }

    return orders.map((o) => ({
      orderId: o._id,
      buyerName: o.buyer.name,
      description: o.description,
      amount: o.amount,
      deliveryDate: o.deliveryDate,
      status: o.orderStatus,
    }));
  }

  async getBuyerOngoingOrders(buyerId: string): Promise<{ orderId: string; sellerName: string; description: string; amount: number; deliveryDate: string; status: string }[]> {
    const db = this.firestoreProvider.getDb();
    const ongoingStatuses = ['ORDER_CREATED', 'IN_TRANSIT', 'SHIPPED'];

    const snapshots = await Promise.all(
      ongoingStatuses.map((status) =>
        db.collection(this.collection)
          .where('buyer.id', '==', buyerId)
          .where('orderStatus', '==', status)
          .get()
      )
    );

    const orders = snapshots.flatMap((snapshot) =>
      snapshot.docs.map((doc) => doc.data() as CreateOrderDto)
    );

    if (!orders.length) {
      throw new NotFoundException(`No ongoing orders found for buyer ${buyerId}`);
    }

    return orders.map((o) => ({
      orderId: o._id,
      sellerName: o.seller.name,
      description: o.description,
      amount: o.amount,
      deliveryDate: o.deliveryDate,
      status: o.orderStatus,
    }));
  }

  async getBuyerOrderHistory(buyerId: string): Promise<{ orderId: string; sellerName: string; description: string; amount: number; deliveryDate: string; status: string }[]> {
    const db = this.firestoreProvider.getDb();
    const historyStatuses = ['DELIVERED', 'REFUNDED', 'DECLINED'];

    const snapshots = await Promise.all(
      historyStatuses.map((status) =>
        db.collection(this.collection)
          .where('buyer.id', '==', buyerId)
          .where('orderStatus', '==', status)
          .get()
      )
    );

    const orders = snapshots.flatMap((snapshot) =>
      snapshot.docs.map((doc) => doc.data() as CreateOrderDto)
    );

    if (!orders.length) {
      throw new NotFoundException(`No order history found for buyer ${buyerId}`);
    }

    return orders.map((o) => ({
      orderId: o._id,
      sellerName: o.seller.name,
      description: o.description,
      amount: o.amount,
      deliveryDate: o.deliveryDate,
      status: o.orderStatus,
    }));
  }
  private mapShippoStatusToOrderStatus(status: string): OrderStatus {
    const s = status.toUpperCase();
    if (s === 'SHIPPED' || s === 'PRE_TRANSIT' || s === 'UNKNOWN') {
      return OrderStatus.SHIPPED;
    }
    if (s === 'IN_TRANSIT' || s === 'TRANSIT' || s === 'OUT_FOR_DELIVERY') {
      return OrderStatus.IN_TRANSIT;
    }
    if (s === 'DELIVERED') {
      return OrderStatus.DELIVERED;
    }
    if (s === 'FAILED' || s === 'FAILURE' || s === 'RETURNED' || s === 'CANCELLED' || s === 'REFUNDED') {
      return OrderStatus.FAILED;
    }
    return OrderStatus.CREATED;
  }

  private getStatusLabel(status: OrderStatus): string {
    switch (status) {
      case OrderStatus.CREATED:
        return 'Order Created';
      case OrderStatus.ACCEPTED:
        return 'Order Accepted by Seller';
      case OrderStatus.DECLINED:
        return 'Order Declined by Seller';
      case OrderStatus.SHIPPED:
        return 'Order Shipped';
      case OrderStatus.IN_TRANSIT:
        return 'In Transit';
      case OrderStatus.DELIVERED:
        return 'Delivered';
      case OrderStatus.FAILED:
        return 'Delivery Failed';
      case OrderStatus.REFUNDED:
        return 'Amount Refunded';
      default:
        return `Order Status Updated: ${status}`;
    }
  }
}
