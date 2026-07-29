import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class ShippoService {
  private readonly logger = new Logger(ShippoService.name);

  async createTracker(trackingNumber?: string, carrier?: string): Promise<{ id: string; trackingNumber: string; status: string; carrier: string }> {
    const apiKey = process.env.SHIPPO_API_KEY;

    if (!apiKey) {
      this.logger.log('Shippo API key not found in environment. Running in SIMULATED mode.');
      const simulatedId = `shp_sim_${Math.random().toString(36).substring(2, 10)}`;
      return {
        id: simulatedId,
        trackingNumber: trackingNumber || 'SHIPPO_TRANSIT',
        status: 'UNKNOWN',
        carrier: carrier || 'usps',
      };
    }

    try {
      const activeCarrier = carrier || 'usps';
      const activeTrackingNumber = trackingNumber || 'SHIPPO_TRANSIT';
      this.logger.log(`Creating Shippo tracker for ${activeCarrier}: ${activeTrackingNumber}`);

      const apiUrl = process.env.SHIPPO_API_URL || 'https://api.goshippo.com/tracks/';
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `ShippoToken ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tracking_number: activeTrackingNumber,
          carrier: activeCarrier,
        }),
      });

      if (!response.ok) {
        const errorMsg = await response.text();
        throw new Error(`Shippo API returned status ${response.status}: ${errorMsg}`);
      }

      const data: any = await response.json();
      return {
        id: data.object_id || data.id || `shp_${Math.random().toString(36).substring(2, 10)}`,
        trackingNumber: data.tracking_number || activeTrackingNumber,
        status: data.status || 'UNKNOWN',
        carrier: data.carrier || activeCarrier,
      };
    } catch (error) {
      this.logger.error(`Failed to create tracker, falling back to simulation: ${error.message}`);
      const simulatedId = `shp_sim_${Math.random().toString(36).substring(2, 10)}`;
      return {
        id: simulatedId,
        trackingNumber: trackingNumber || 'SHIPPO_TRANSIT',
        status: 'UNKNOWN',
        carrier: carrier || 'usps',
      };
    }
  }
}
