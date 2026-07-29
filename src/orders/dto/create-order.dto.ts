export class PartyDto {
  id: string;
  name: string;
  gculAccountId?: string;
}

export class EscrowDto {
  status: string;
  lockedAmount: number;
  lockedDate: string;
}

export class TimelineEventDto {
  status: string;
  label: string;
  timestamp: string | null;
}

export class ShippoDetailsDto {
  trackerId?: string;
  trackingCode?: string;
  carrier?: string;
}

export enum OrderStatus {
  CREATED = 'CREATED',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  SHIPPED = 'SHIPPED',
  IN_TRANSIT = 'IN_TRANSIT',
  DELIVERED = 'DELIVERED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
}

export class CreateOrderDto {
  _id: string;
  buyer: PartyDto;
  seller: PartyDto;
  description: string;
  amount: number;
  currency: string;
  deliveryDate: string;
  orderStatus: OrderStatus;
  escrow: EscrowDto;
  timeline: TimelineEventDto[];
  shippoDetails?: ShippoDetailsDto;
  createdAt: string;
  updatedAt: string;
}
