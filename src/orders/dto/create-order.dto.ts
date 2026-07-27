export class PartyDto {
  id: string;
  name: string;
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

export class CreateOrderDto {
  _id: string;
  buyer: PartyDto;
  seller: PartyDto;
  description: string;
  amount: number;
  currency: string;
  deliveryDate: string;
  orderStatus: string;
  escrow: EscrowDto;
  timeline: TimelineEventDto[];
  createdAt: string;
  updatedAt: string;
}
