const { v4: uuidv4 } = require('uuid');
const mongoose = require('mongoose');

/* -------------------------
   LOGISTICS SERVICE
   Pure business logic - no direct DB queries for external data
-------------------------- */

class LogisticsService {
  constructor(ports) {
    // Required ports
    this.warehousePort = ports.warehousePort;
    this.transferPort = ports.transferPort;
    this.geocodingPort = ports.geocodingPort;
    this.settingsPort = ports.settingsPort;
    
    // Optional ports
    this.supplierPort = ports.supplierPort || null;
    this.notificationPort = ports.notificationPort || null;
    this.eventBus = ports.eventBus || null;
  }
  
  /* ========== 1. ROUTE PLANNING (CORE ALGORITHM) ========== */
  
  /**
   * Plan optimal route for multiple stops
   * @param {Object} request - { originLocationId, destinationLocationIds, constraints, startTime, vehicleId }
   * @returns {Promise<Object>} - Route plan
   */
  async planRoute(request) {
    const {
      orgCode,
      originLocationId,
      destinationLocationIds,
      constraints = {},
      startTime = new Date(),
      optimizationStrategy = 'shortest_distance',
      vehicleId = null,
      createdBy = 'system'
    } = request;
    
    // Get all warehouse locations
    const origin = await this.warehousePort.getWarehouse(originLocationId);
    if (!origin) {
      throw new Error(`Origin warehouse not found: ${originLocationId}`);
    }
    
    const destinations = await Promise.all(
      destinationLocationIds.map(id => this.warehousePort.getWarehouse(id))
    );
    
    // Build distance matrix
    const allLocations = [origin, ...destinations];
    const distanceMatrix = await this.buildDistanceMatrix(allLocations);
    
    // Find optimal sequence (TSP heuristic)
    const optimalSequence = this.solveTSP(distanceMatrix, optimizationStrategy);
    
    // Build route stops
    const stops = [];
    let totalDistance = 0;
    let totalDuration = 0;
    let expectedLoadKg = 0;
    let expectedLoadM3 = 0;
    
    for (let i = 0; i < optimalSequence.length; i++) {
      const locationIndex = optimalSequence[i];
      const location = allLocations[locationIndex];
      
      const stop = {
        sequence: i,
        locationId: location._id || location.id,
        locationName: location.name,
        locationCoordinates: location.location?.coordinates || null,
        action: i === 0 ? 'pickup' : 'dropoff',
        estimatedArrival: null,
        estimatedDeparture: null,
        expectedLoadKg: i === 0 ? 0 : expectedLoadKg,
        expectedLoadM3: i === 0 ? 0 : expectedLoadM3
      };
      
      stops.push(stop);
      
      if (i > 0) {
        const prevIndex = optimalSequence[i - 1];
        const distance = distanceMatrix[prevIndex][locationIndex].distanceKm;
        const duration = distanceMatrix[prevIndex][locationIndex].durationHours;
        totalDistance += distance;
        totalDuration += duration;
        
        // Estimate load (add from previous stop's expected pickup)
        if (i === 1) {
          expectedLoadKg += constraints.estimatedWeight || 100;
          expectedLoadM3 += constraints.estimatedVolume || 0.5;
        }
        stop.expectedLoadKg = expectedLoadKg;
        stop.expectedLoadM3 = expectedLoadM3;
      }
    }
    
    // Get vehicle if provided for capacity validation
    let vehicle = null;
    if (vehicleId) {
      const Vehicle = mongoose.model('Vehicle');
      vehicle = await Vehicle.findOne({ vehicleId, orgCode });
    }
    
    // Apply constraints
    const settings = await this.settingsPort.getLogisticsSettings();
    const maxStops = constraints.maxStops || settings.maxStopsPerRoute || 10;
    const maxDistance = constraints.maxDistanceKm || settings.maxRouteDistanceKm || 500;
    
    if (stops.length > maxStops) {
      throw new Error(`Too many stops (${stops.length}) exceeds max (${maxStops})`);
    }
    
    if (totalDistance > maxDistance) {
      throw new Error(`Route distance (${totalDistance}km) exceeds max (${maxDistance}km)`);
    }
    
    // Calculate estimated times
    const estimatedTimes = this.calculateEstimatedTimes(stops, startTime, distanceMatrix, optimalSequence);
    
    // Calculate cost
    const totalCost = this.calculateRouteCost(totalDistance, totalDuration, settings);
    
    // Validate vehicle capacity if provided
    let capacityValidation = { valid: true, issues: [] };
    if (vehicle) {
      const tempRoute = { stops: estimatedTimes, totalDistanceKm: totalDistance, totalDurationHours: totalDuration };
      capacityValidation = this.validateRouteCapacity(tempRoute, vehicle);
    }
    
    // Create route
    const Route = mongoose.model('Route');
    const route = new Route({
      routeId: `RTE-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orgCode,
      stops: estimatedTimes,
      totalDistanceKm: totalDistance,
      totalDurationHours: totalDuration,
      estimatedCost: totalCost,
      constraints: {
        maxStops,
        maxDistanceKm: maxDistance,
        ...constraints
      },
      optimizationStrategy,
      optimizationScore: this.calculateOptimizationScore(totalDistance, totalDuration, totalCost),
      isOptimized: true,
      createdBy,
      version: 1
    });
    
    await route.save();
    
    // Emit event if event bus available
    if (this.eventBus) {
      await this.eventBus.emit({
        type: 'ROUTE_PLANNED',
        orgCode,
        routeId: route._id,
        totalDistance,
        totalDuration,
        totalCost,
        stops: stops.length,
        timestamp: new Date()
      });
    }
    
    return { route, capacityValidation };
  }
  
  /**
   * Validate route against vehicle capacity
   */
  validateRouteCapacity(route, vehicle) {
    if (!vehicle) return { valid: true, issues: [] };
    
    const issues = [];
    const totalWeight = Math.max(...route.stops.map(s => s.expectedLoadKg || 0));
    const totalVolume = Math.max(...route.stops.map(s => s.expectedLoadM3 || 0));
    
    if (totalWeight > vehicle.maxWeightKg) {
      issues.push(`Route exceeds vehicle weight capacity: ${totalWeight}kg > ${vehicle.maxWeightKg}kg`);
    }
    
    if (vehicle.maxVolumeM3 && totalVolume > vehicle.maxVolumeM3) {
      issues.push(`Route exceeds vehicle volume capacity: ${totalVolume}m³ > ${vehicle.maxVolumeM3}m³`);
    }
    
    if (route.stops.length > vehicle.maxStopsPerTrip) {
      issues.push(`Route exceeds max stops: ${route.stops.length} > ${vehicle.maxStopsPerTrip}`);
    }
    
    return {
      valid: issues.length === 0,
      issues,
      totalWeight,
      totalVolume,
      totalStops: route.stops.length
    };
  }
  
  /**
   * Build distance matrix between locations
   */
  async buildDistanceMatrix(locations) {
    const n = locations.length;
    const matrix = Array(n).fill().map(() => Array(n).fill(null));
    
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) {
          matrix[i][j] = { distanceKm: 0, durationHours: 0 };
        } else if (matrix[j][i]) {
          matrix[i][j] = matrix[j][i];
        } else {
          const from = locations[i];
          const to = locations[j];
          
          if (from.location?.coordinates && to.location?.coordinates) {
            const distance = await this.geocodingPort.getDistance(
              from.location.coordinates,
              to.location.coordinates
            );
            matrix[i][j] = distance;
          } else {
            matrix[i][j] = { distanceKm: 100, durationHours: 2 }; // fallback
          }
        }
      }
    }
    
    return matrix;
  }
  
  /**
   * Solve TSP (Nearest Neighbor heuristic)
   */
  solveTSP(distanceMatrix, strategy = 'shortest_distance') {
    const n = distanceMatrix.length;
    const visited = new Array(n).fill(false);
    const path = [0]; // Start at origin (index 0)
    visited[0] = true;
    
    for (let step = 1; step < n; step++) {
      let lastNode = path[path.length - 1];
      let bestIndex = -1;
      let bestValue = Infinity;
      
      for (let i = 0; i < n; i++) {
        if (!visited[i]) {
          let value;
          switch (strategy) {
            case 'shortest_distance':
              value = distanceMatrix[lastNode][i].distanceKm;
              break;
            case 'fastest_time':
              value = distanceMatrix[lastNode][i].durationHours;
              break;
            case 'cheapest_cost':
              value = distanceMatrix[lastNode][i].distanceKm;
              break;
            default:
              value = distanceMatrix[lastNode][i].distanceKm;
          }
          
          if (value < bestValue) {
            bestValue = value;
            bestIndex = i;
          }
        }
      }
      
      if (bestIndex !== -1) {
        path.push(bestIndex);
        visited[bestIndex] = true;
      }
    }
    
    return path;
  }
  
  /**
   * Calculate estimated arrival/departure times
   */
  calculateEstimatedTimes(stops, startTime, distanceMatrix, optimalSequence) {
    let currentTime = new Date(startTime);
    const averageSpeedKmh = 50;
    const stopDurationHours = 0.5;
    
    for (let i = 0; i < stops.length; i++) {
      stops[i].estimatedArrival = new Date(currentTime);
      
      if (i === 0) {
        stops[i].estimatedDeparture = new Date(currentTime.getTime() + stopDurationHours * 60 * 60 * 1000);
      } else {
        const prevIndex = optimalSequence[i - 1];
        const currIndex = optimalSequence[i];
        const travelHours = distanceMatrix[prevIndex][currIndex].durationHours;
        
        currentTime = new Date(currentTime.getTime() + travelHours * 60 * 60 * 1000);
        stops[i].estimatedArrival = new Date(currentTime);
        
        currentTime = new Date(currentTime.getTime() + stopDurationHours * 60 * 60 * 1000);
        stops[i].estimatedDeparture = new Date(currentTime);
      }
    }
    
    return stops;
  }
  
  /**
   * Calculate route cost based on distance and settings
   */
  calculateRouteCost(totalDistanceKm, totalDurationHours, settings) {
    const fuelCostPerKm = settings.fuelCostPerKm || 150;
    const laborCostPerHour = settings.laborCostPerHour || 500;
    const fixedCostPerTrip = settings.fixedCostPerTrip || 1000;
    
    const fuelCost = totalDistanceKm * fuelCostPerKm;
    const laborCost = totalDurationHours * laborCostPerHour;
    
    return fixedCostPerTrip + fuelCost + laborCost;
  }
  
  /**
   * Calculate optimization score
   */
  calculateOptimizationScore(distance, duration, cost) {
    const distanceScore = Math.max(0, 100 - (distance / 10));
    const durationScore = Math.max(0, 100 - (duration));
    const costScore = Math.max(0, 100 - (cost / 1000));
    
    return (distanceScore + durationScore + costScore) / 3;
  }
  
  /* ========== 2. SHIPMENT CREATION ========== */
  
  /**
   * Create shipment from transfer (optimizer integration)
   */
  async createShipmentFromTransfer(transfer, orgCode, correlationId = null) {
    const Shipment = mongoose.model('Shipment');
    
    const shipment = Shipment.fromTransfer(transfer, orgCode, correlationId);
    
    // Plan schedule
    const settings = await this.settingsPort.getLogisticsSettings();
    shipment.planSchedule(settings);
    
    await shipment.save();
    
    // Create stops
    const ShipmentStop = mongoose.model('ShipmentStop');
    const stop = new ShipmentStop({
      shipmentId: shipment._id,
      orgCode,
      stopNumber: 1,
      locationId: transfer.toWarehouseId,
      locationType: 'warehouse',
      action: 'dropoff',
      items: transfer.items || [],
      plannedArrivalAt: shipment.plannedDeliveryAt,
      status: 'pending'
    });
    await stop.save();
    
    if (this.eventBus) {
      await this.eventBus.emit({
        type: 'SHIPMENT_CREATED',
        orgCode,
        shipmentId: shipment.shipmentId,
        referenceId: transfer._id,
        referenceType: 'transfer',
        timestamp: new Date()
      });
    }
    
    return shipment;
  }
  
  /**
   * Create shipment from purchase order
   */
  async createShipmentFromPurchaseOrder(purchaseOrder, orgCode, correlationId = null) {
    const Shipment = mongoose.model('Shipment');
    
    const shipment = Shipment.fromPurchaseOrder(purchaseOrder, orgCode, correlationId);
    
    // Plan schedule
    const settings = await this.settingsPort.getLogisticsSettings();
    shipment.planSchedule(settings);
    
    await shipment.save();
    
    const ShipmentStop = mongoose.model('ShipmentStop');
    const stop = new ShipmentStop({
      shipmentId: shipment._id,
      orgCode,
      stopNumber: 1,
      locationId: purchaseOrder.destinationWarehouseId,
      locationType: 'warehouse',
      action: 'dropoff',
      items: purchaseOrder.items || [],
      plannedArrivalAt: shipment.plannedDeliveryAt,
      status: 'pending'
    });
    await stop.save();
    
    if (this.eventBus) {
      await this.eventBus.emit({
        type: 'SHIPMENT_CREATED',
        orgCode,
        shipmentId: shipment.shipmentId,
        referenceId: purchaseOrder._id,
        referenceType: 'purchase_order',
        timestamp: new Date()
      });
    }
    
    return shipment;
  }
  
  /**
   * Create shipment from optimized route
   */
  async createShipmentFromRoute(request) {
    const {
      routeId,
      referenceId,
      referenceType,
      items,
      createdBy,
      orgCode,
      priority = 5,
      sourceSystem = 'optimizer'
    } = request;
    
    const Route = mongoose.model('Route');
    const route = await Route.findOne({ routeId, orgCode });
    
    if (!route) {
      throw new Error(`Route not found: ${routeId}`);
    }
    
    const Shipment = mongoose.model('Shipment');
    const shipment = new Shipment({
      shipmentId: `SHP-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orgCode,
      type: this.determineShipmentType(referenceType),
      referenceId,
      referenceType,
      sourceSystem,
      correlationId: uuidv4(),
      priority,
      originLocationId: route.stops[0].locationId,
      destinationLocationId: route.stops[route.stops.length - 1].locationId,
      status: 'planned',
      plannedDispatchAt: route.stops[0].estimatedDeparture,
      plannedDeliveryAt: route.stops[route.stops.length - 1].estimatedArrival,
      routeId: route._id,
      costSnapshot: {
        totalDistanceKm: route.totalDistanceKm,
        totalCost: route.estimatedCost,
        costPerKm: route.estimatedCost / route.totalDistanceKm,
        fuelCost: route.estimatedCost * 0.6,
        calculatedAt: new Date()
      },
      items: items || [],
      createdBy
    });
    
    await shipment.save();
    
    // Create stops
    const ShipmentStop = mongoose.model('ShipmentStop');
    for (let i = 0; i < route.stops.length; i++) {
      const routeStop = route.stops[i];
      const stop = new ShipmentStop({
        shipmentId: shipment._id,
        orgCode,
        stopNumber: routeStop.sequence,
        locationId: routeStop.locationId,
        locationName: routeStop.locationName,
        locationType: i === 0 ? 'warehouse' : (i === route.stops.length - 1 ? 'store' : 'warehouse'),
        action: routeStop.action,
        items: i === route.stops.length - 1 ? items : [],
        plannedArrivalAt: routeStop.estimatedArrival,
        plannedDepartureAt: routeStop.estimatedDeparture,
        distanceFromPreviousKm: i > 0 ? routeStop.estimatedArrival - route.stops[i-1].estimatedDeparture : 0,
        status: 'pending'
      });
      await stop.save();
    }
    
    shipment.addTrackingEvent('created', route.stops[0].locationId, null, 'Shipment created from route');
    await shipment.save();
    
    route.incrementUsage();
    await route.save();
    
    if (this.eventBus) {
      await this.eventBus.emit({
        type: 'SHIPMENT_CREATED_FROM_ROUTE',
        orgCode,
        shipmentId: shipment.shipmentId,
        routeId,
        timestamp: new Date()
      });
    }
    
    return shipment;
  }
  
  /**
   * Determine shipment type from reference
   */
  determineShipmentType(referenceType) {
    const typeMap = {
      'transfer': 'transfer',
      'purchase_order': 'inbound',
      'return': 'outbound'
    };
    return typeMap[referenceType] || 'transfer';
  }
  
  /* ========== 3. SHIPMENT LIFECYCLE MANAGEMENT ========== */
  
  /**
   * Dispatch shipment with vehicle assignment
   */
  async dispatchShipment(shipmentId, orgCode, vehicleId = null, driverName = null, driverContact = null) {
    const Shipment = mongoose.model('Shipment');
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    if (shipment.status !== 'planned') {
      throw new Error(`Cannot dispatch shipment in status: ${shipment.status}`);
    }
    
    // Assign vehicle if provided
    let vehicle = null;
    if (vehicleId) {
      const Vehicle = mongoose.model('Vehicle');
      vehicle = await Vehicle.findOne({ vehicleId, orgCode });
      if (vehicle && vehicle.isAvailable()) {
        vehicle.assignToShipment(shipment._id);
        await vehicle.save();
        shipment.vehicleId = vehicle._id;
      }
    }
    
    shipment.dispatch(vehicleId, driverName, driverContact);
    await shipment.save();
    
    // Update stops status
    const ShipmentStop = mongoose.model('ShipmentStop');
    await ShipmentStop.updateMany(
      { shipmentId: shipment._id, stopNumber: 1 },
      { status: 'arrived' }
    );
    
    if (this.eventBus) {
      await this.eventBus.emit({
        type: 'SHIPMENT_DISPATCHED',
        orgCode,
        shipmentId: shipment.shipmentId,
        vehicleId,
        driverName,
        timestamp: new Date()
      });
    }
    
    if (this.notificationPort) {
      await this.notificationPort.notify('shipment_dispatched', { shipmentId, orgCode });
    }
    
    return { shipment, vehicle };
  }
  
  /**
   * Mark stop as arrived
   */
  async arriveAtStop(shipmentId, stopNumber, orgCode) {
    const Shipment = mongoose.model('Shipment');
    const ShipmentStop = mongoose.model('ShipmentStop');
    
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    const stop = await ShipmentStop.findOne({ shipmentId: shipment._id, stopNumber });
    if (!stop) {
      throw new Error(`Stop not found: ${stopNumber}`);
    }
    
    const now = new Date();
    stop.status = 'arrived';
    stop.actualArrivalAt = now;
    
    // Calculate delay
    if (stop.plannedArrivalAt) {
      stop.delayMinutes = Math.max(0, (now - stop.plannedArrivalAt) / (1000 * 60));
    }
    
    await stop.save();
    
    shipment.addTrackingEvent('arrived_at_stop', stop.locationId, stop._id, `Arrived at stop ${stopNumber}`);
    
    // Update shipment status to in_transit if not already
    if (shipment.status !== 'in_transit') {
      shipment.status = 'in_transit';
    }
    await shipment.save();
    
    return stop;
  }
  
  /**
   * Complete stop with delivery confirmation
   */
  async completeStop(shipmentId, stopNumber, orgCode, itemsDelivered = null, rejectionReason = null) {
    const Shipment = mongoose.model('Shipment');
    const ShipmentStop = mongoose.model('ShipmentStop');
    
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    const stop = await ShipmentStop.findOne({ shipmentId: shipment._id, stopNumber });
    if (!stop) {
      throw new Error(`Stop not found: ${stopNumber}`);
    }
    
    const now = new Date();
    stop.status = 'completed';
    stop.actualDepartureAt = now;
    
    if (itemsDelivered) {
      for (const delivered of itemsDelivered) {
        const item = stop.items.find(i => i.productId.toString() === delivered.productId);
        if (item) {
          item.receivedQuantity = delivered.quantity;
          if (rejectionReason) item.rejectionReason = rejectionReason;
        }
      }
    }
    
    // Calculate completion percentage
    const totalItems = stop.items.reduce((sum, i) => sum + i.quantity, 0);
    const receivedItems = stop.items.reduce((sum, i) => sum + (i.receivedQuantity || 0), 0);
    stop.completionPercentage = totalItems > 0 ? (receivedItems / totalItems) * 100 : 100;
    
    // Calculate variance
    if (stop.plannedDepartureAt) {
      stop.varianceMinutes = (now - stop.plannedDepartureAt) / (1000 * 60);
    }
    
    await stop.save();
    
    shipment.addTrackingEvent('departed_stop', stop.locationId, stop._id, `Completed stop ${stopNumber}`);
    await shipment.save();
    
    return stop;
  }
  
  /**
   * Complete entire shipment delivery
   */
  async completeDelivery(shipmentId, orgCode) {
    const Shipment = mongoose.model('Shipment');
    const ShipmentStop = mongoose.model('ShipmentStop');
    
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    const stops = await ShipmentStop.find({ shipmentId: shipment._id }).sort({ stopNumber: 1 });
    
    // Mark any remaining stops as completed
    for (const stop of stops) {
      if (stop.status !== 'completed') {
        stop.status = 'completed';
        stop.actualArrivalAt = stop.actualArrivalAt || new Date();
        stop.actualDepartureAt = new Date();
        await stop.save();
      }
    }
    
    shipment.deliver();
    await shipment.save();
    
    // Release vehicle if assigned
    if (shipment.vehicleId) {
      const Vehicle = mongoose.model('Vehicle');
      const vehicle = await Vehicle.findById(shipment.vehicleId);
      if (vehicle) {
        vehicle.releaseFromShipment();
        await vehicle.save();
      }
    }
    
    // Update reference if transfer
    if (shipment.referenceType === 'transfer' && shipment.referenceId && this.transferPort) {
      await this.transferPort.updateTransferStatus(shipment.referenceId, 'completed');
    }
    
    // Record performance feedback
    await this.recordRoutePerformance(shipment);
    
    if (this.eventBus) {
      await this.eventBus.emit({
        type: 'SHIPMENT_DELIVERED',
        orgCode,
        shipmentId: shipment.shipmentId,
        actualDurationHours: shipment.performanceMetrics?.actualDurationHours,
        onTimeDelivery: shipment.performanceMetrics?.onTimeDelivery,
        timestamp: new Date()
      });
    }
    
    return shipment;
  }
  
  /**
   * Cancel shipment
   */
  async cancelShipment(shipmentId, orgCode, reason) {
    const Shipment = mongoose.model('Shipment');
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    if (shipment.status === 'delivered') {
      throw new Error('Cannot cancel delivered shipment');
    }
    
    shipment.status = 'cancelled';
    shipment.addTrackingEvent('cancelled', shipment.originLocationId, null, reason || 'Shipment cancelled');
    await shipment.save();
    
    // Release vehicle if assigned
    if (shipment.vehicleId) {
      const Vehicle = mongoose.model('Vehicle');
      const vehicle = await Vehicle.findById(shipment.vehicleId);
      if (vehicle) {
        vehicle.releaseFromShipment();
        await vehicle.save();
      }
    }
    
    if (this.eventBus) {
      await this.eventBus.emit({
        type: 'SHIPMENT_CANCELLED',
        orgCode,
        shipmentId: shipment.shipmentId,
        reason,
        timestamp: new Date()
      });
    }
    
    return shipment;
  }
  
  /* ========== 4. COST & ETA CALCULATION ========== */
  
  /**
   * Calculate real-time ETA for active shipment
   */
  async calculateETA(shipmentId, orgCode, currentLocationCoords = null) {
    const Shipment = mongoose.model('Shipment');
    const ShipmentStop = mongoose.model('ShipmentStop');
    
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    const stops = await ShipmentStop.find({ shipmentId: shipment._id }).sort({ stopNumber: 1 });
    const remainingStops = stops.filter(s => s.status !== 'completed');
    
    if (remainingStops.length === 0) {
      return { eta: new Date(), remainingHours: 0, message: 'Shipment completed' };
    }
    
    // Get current location
    let currentCoords = currentLocationCoords;
    if (!currentCoords) {
      const lastCompleted = stops.find(s => s.status === 'completed');
      if (lastCompleted) {
        const warehouse = await this.warehousePort.getWarehouse(lastCompleted.locationId);
        if (warehouse?.location?.coordinates) {
          currentCoords = warehouse.location.coordinates;
        }
      } else if (shipment.originLocationId) {
        const origin = await this.warehousePort.getWarehouse(shipment.originLocationId);
        if (origin?.location?.coordinates) {
          currentCoords = origin.location.coordinates;
        }
      }
    }
    
    let totalRemainingHours = 0;
    let prevCoords = currentCoords;
    const etaByStop = [];
    
    for (let i = 0; i < remainingStops.length; i++) {
      const stop = remainingStops[i];
      const warehouse = await this.warehousePort.getWarehouse(stop.locationId);
      
      if (prevCoords && warehouse?.location?.coordinates) {
        const distance = await this.geocodingPort.getDistance(prevCoords, warehouse.location.coordinates);
        totalRemainingHours += distance.durationHours;
      }
      
      totalRemainingHours += 0.5; // stop time
      
      const eta = new Date(Date.now() + totalRemainingHours * 60 * 60 * 1000);
      etaByStop.push({
        stopNumber: stop.stopNumber,
        locationId: stop.locationId,
        eta,
        cumulativeHours: totalRemainingHours
      });
      
      prevCoords = warehouse?.location?.coordinates;
    }
    
    const finalEta = etaByStop[etaByStop.length - 1]?.eta || new Date();
    
    return {
      eta: finalEta,
      remainingHours: totalRemainingHours,
      remainingStops: remainingStops.length,
      currentLocation: currentCoords,
      etaByStop
    };
  }
  
  /**
   * Calculate actual vs planned costs
   */
  async calculateActualCost(shipmentId, orgCode, actualFuelCost, actualLaborHours, actualDistanceKm = null) {
    const Shipment = mongoose.model('Shipment');
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    const settings = await this.settingsPort.getLogisticsSettings();
    const laborCostPerHour = settings.laborCostPerHour || 500;
    
    const actualTotalCost = actualFuelCost + (actualLaborHours * laborCostPerHour);
    const plannedTotalCost = shipment.costSnapshot.totalCost;
    const variance = actualTotalCost - plannedTotalCost;
    
    // Update shipment with actual costs
    shipment.costSnapshot.actualCost = actualTotalCost;
    shipment.costSnapshot.actualFuelCost = actualFuelCost;
    shipment.costSnapshot.actualLaborHours = actualLaborHours;
    if (actualDistanceKm) {
      shipment.costSnapshot.actualDistanceKm = actualDistanceKm;
    }
    await shipment.save();
    
    return {
      planned: plannedTotalCost,
      actual: actualTotalCost,
      variance,
      variancePercent: (variance / plannedTotalCost) * 100
    };
  }
  
  /* ========== 5. FEEDBACK LOOP (Learning) ========== */
  
  /**
   * Record route performance after delivery
   */
  async recordRoutePerformance(shipment) {
    const RoutePerformance = mongoose.model('RoutePerformance');
    const Route = mongoose.model('Route');
    const ShipmentStop = mongoose.model('ShipmentStop');
    
    const route = await Route.findById(shipment.routeId);
    if (!route) return;
    
    const stops = await ShipmentStop.find({ shipmentId: shipment._id }).sort({ stopNumber: 1 });
    
    // Calculate actual duration
    const actualDuration = shipment.actualDeliveryAt && shipment.actualDispatchAt
      ? (shipment.actualDeliveryAt - shipment.actualDispatchAt) / (1000 * 60 * 60)
      : route.totalDurationHours;
    
    const plannedDuration = route.totalDurationHours;
    
    // Collect delay reasons from stops
    const delayReasons = stops
      .filter(s => s.delayMinutes > 15)
      .map(s => ({
        stopId: s._id,
        stopName: s.locationName,
        reason: s.delayReason || 'Unknown delay',
        extraMinutes: s.delayMinutes,
        category: this.categorizeDelay(s.delayReason)
      }));
    
    const performance = new RoutePerformance({
      orgCode: shipment.orgCode,
      routeId: route._id,
      shipmentId: shipment._id,
      plannedDistanceKm: route.totalDistanceKm,
      actualDistanceKm: shipment.costSnapshot?.actualDistanceKm || route.totalDistanceKm,
      plannedDurationHours: plannedDuration,
      actualDurationHours: actualDuration,
      plannedCost: route.estimatedCost,
      actualCost: shipment.costSnapshot?.actualCost || route.estimatedCost,
      delayReasons,
      efficiencyScore: this.calculateEfficiencyScore(plannedDuration, actualDuration, route.estimatedCost, shipment.costSnapshot?.actualCost),
      recordedAt: new Date(),
      recordedBy: shipment.createdBy
    });
    
    await performance.save();
    
    // Update route with aggregate performance
    const allPerformances = await RoutePerformance.find({ routeId: route.routeId });
    const avgEfficiency = allPerformances.reduce((sum, p) => sum + p.efficiencyScore, 0) / allPerformances.length;
    
    route.optimizationScore = (route.optimizationScore + avgEfficiency) / 2;
    await route.save();
    
    if (this.eventBus) {
      await this.eventBus.emit({
        type: 'ROUTE_PERFORMANCE_RECORDED',
        orgCode: shipment.orgCode,
        routeId: route._id,
        efficiencyScore: performance.efficiencyScore,
        timestamp: new Date()
      });
    }
    
    return performance;
  }
  
  /**
   * Categorize delay reason
   */
  categorizeDelay(delayReason) {
    const categories = {
      'traffic': 'traffic',
      'loading': 'loading',
      'unloading': 'unloading',
      'mechanical': 'mechanical',
      'weather': 'weather'
    };
    
    for (const [key, value] of Object.entries(categories)) {
      if (delayReason?.toLowerCase().includes(key)) {
        return value;
      }
    }
    return 'other';
  }
  
  /**
   * Calculate efficiency score
   */
  calculateEfficiencyScore(plannedDuration, actualDuration, plannedCost, actualCost) {
    let score = 100;
    
    // Duration penalty (up to 50 points)
    if (actualDuration > plannedDuration) {
      const durationPenalty = Math.min(50, ((actualDuration - plannedDuration) / plannedDuration) * 100);
      score -= durationPenalty;
    }
    
    // Cost penalty (up to 30 points)
    if (actualCost && actualCost > plannedCost) {
      const costPenalty = Math.min(30, ((actualCost - plannedCost) / plannedCost) * 100);
      score -= costPenalty;
    }
    
    return Math.max(0, Math.min(100, score));
  }
  
  /* ========== 6. VEHICLE MANAGEMENT ========== */
  
  /**
   * Create vehicle
   */
  async createVehicle(vehicleData, orgCode, createdBy) {
    const Vehicle = mongoose.model('Vehicle');
    
    const vehicle = new Vehicle({
      vehicleId: `VEH-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      orgCode,
      ...vehicleData,
      createdBy
    });
    
    await vehicle.save();
    return vehicle;
  }
  
  /**
   * Get available vehicles
   */
  async getAvailableVehicles(orgCode, requiredCapacityKg = null, requiredVolumeM3 = null) {
    const Vehicle = mongoose.model('Vehicle');
    const query = { orgCode, status: 'active' };
    
    let vehicles = await Vehicle.find(query);
    
    // Filter by capacity if specified
    if (requiredCapacityKg) {
      vehicles = vehicles.filter(v => v.maxWeightKg >= requiredCapacityKg);
    }
    if (requiredVolumeM3) {
      vehicles = vehicles.filter(v => !v.maxVolumeM3 || v.maxVolumeM3 >= requiredVolumeM3);
    }
    
    // Filter available (not on trip)
    vehicles = vehicles.filter(v => v.isAvailable());
    
    return vehicles;
  }
  
  /**
   * Assign vehicle to shipment
   */
  async assignVehicleToShipment(vehicleId, shipmentId, orgCode) {
    const Vehicle = mongoose.model('Vehicle');
    const Shipment = mongoose.model('Shipment');
    
    const vehicle = await Vehicle.findOne({ vehicleId, orgCode });
    if (!vehicle) {
      throw new Error(`Vehicle not found: ${vehicleId}`);
    }
    
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    if (!vehicle.isAvailable()) {
      throw new Error(`Vehicle ${vehicleId} is not available`);
    }
    
    vehicle.assignToShipment(shipment._id);
    await vehicle.save();
    
    shipment.vehicleId = vehicle._id;
    await shipment.save();
    
    return { vehicle, shipment };
  }
  
  /* ========== 7. DELIVERY SLOT MANAGEMENT ========== */
  
  /**
   * Get available delivery slots for location
   */
  async getAvailableDeliverySlots(locationId, orgCode, date = new Date()) {
    const DeliverySlot = mongoose.model('DeliverySlot');
    
    const dayOfWeek = date.getDay(); // 0-6
    const slots = await DeliverySlot.find({
      orgCode,
      locationId,
      dayOfWeek,
      isActive: true
    });
    
    return slots.filter(slot => slot.isAvailable());
  }
  
  /**
   * Book delivery slot
   */
  async bookDeliverySlot(slotId, shipmentId, orgCode) {
    const DeliverySlot = mongoose.model('DeliverySlot');
    const Shipment = mongoose.model('Shipment');
    
    const slot = await DeliverySlot.findById(slotId);
    if (!slot) {
      throw new Error(`Delivery slot not found: ${slotId}`);
    }
    
    if (!slot.isAvailable()) {
      throw new Error(`Delivery slot is not available`);
    }
    
    slot.bookSlot();
    await slot.save();
    
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    if (shipment) {
      shipment.metadata = {
        ...shipment.metadata,
        deliverySlotId: slotId,
        deliverySlotTime: `${slot.timeStart}-${slot.timeEnd}`
      };
      await shipment.save();
    }
    
    return slot;
  }
  
  /* ========== 8. QUERY METHODS ========== */
  
  /**
   * Get shipment by ID with full details
   */
  async getShipment(shipmentId, orgCode) {
    const Shipment = mongoose.model('Shipment');
    const ShipmentStop = mongoose.model('ShipmentStop');
    
    const shipment = await Shipment.findOne({ shipmentId, orgCode })
      .populate('vehicleId', 'registrationNumber type maxWeightKg');
    
    if (!shipment) return null;
    
    const stops = await ShipmentStop.find({ shipmentId: shipment._id }).sort({ stopNumber: 1 });
    
    return {
      ...shipment.toObject(),
      stops
    };
  }
  
  /**
   * Get all shipments with filters
   */
  async getShipments(orgCode, filters = {}) {
    const Shipment = mongoose.model('Shipment');
    const query = { orgCode };
    
    if (filters.status) query.status = filters.status;
    if (filters.type) query.type = filters.type;
    if (filters.referenceType) query.referenceType = filters.referenceType;
    if (filters.fromDate) query.createdAt = { $gte: filters.fromDate };
    if (filters.toDate) query.createdAt = { ...query.createdAt, $lte: filters.toDate };
    
    return Shipment.find(query)
      .sort({ createdAt: -1 })
      .limit(filters.limit || 100);
  }
  
  /**
   * Get active shipments
   */
  async getActiveShipments(orgCode, warehouseId = null) {
    const Shipment = mongoose.model('Shipment');
    const query = {
      orgCode,
      status: { $in: ['planned', 'dispatched', 'in_transit'] }
    };
    
    if (warehouseId) {
      query.$or = [
        { originLocationId: warehouseId },
        { destinationLocationId: warehouseId }
      ];
    }
    
    const shipments = await Shipment.find(query).sort({ plannedDispatchAt: 1 });
    return shipments;
  }
  
  /**
   * Get shipment tracking history
   */
  async getTrackingHistory(shipmentId, orgCode) {
    const Shipment = mongoose.model('Shipment');
    const shipment = await Shipment.findOne({ shipmentId, orgCode });
    
    if (!shipment) {
      throw new Error(`Shipment not found: ${shipmentId}`);
    }
    
    return shipment.trackingEvents || [];
  }
  
  /**
   * Get route performance analytics
   */
  async getRoutePerformance(routeId, orgCode, days = 30) {
    const RoutePerformance = mongoose.model('RoutePerformance');
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const performances = await RoutePerformance.find({
      routeId,
      orgCode,
      recordedAt: { $gte: startDate }
    }).sort({ recordedAt: -1 });
    
    const avgEfficiency = performances.reduce((sum, p) => sum + p.efficiencyScore, 0) / performances.length;
    const avgDurationVariance = performances.reduce((sum, p) => sum + (p.durationVariancePercent || 0), 0) / performances.length;
    
    return {
      routeId,
      performances,
      averageEfficiencyScore: avgEfficiency,
      averageDurationVariance: avgDurationVariance,
      totalTrips: performances.length,
      onTimeRate: performances.filter(p => p.durationVariancePercent <= 10).length / performances.length * 100
    };
  }
}

/* -------------------------
   PORT IMPLEMENTATIONS (Adapters)
-------------------------- */

class WarehousePort {
  constructor() {
    this.cache = new Map();
  }
  
  async getWarehouse(warehouseId) {
    if (this.cache.has(warehouseId)) {
      return this.cache.get(warehouseId);
    }
    
    const Warehouse = mongoose.model('Warehouse');
    let warehouse;
    
    if (mongoose.Types.ObjectId.isValid(warehouseId)) {
      warehouse = await Warehouse.findById(warehouseId);
    }
    
    if (!warehouse) {
      warehouse = await Warehouse.findOne({ locationId: warehouseId });
    }
    
    if (warehouse) {
      this.cache.set(warehouseId, warehouse);
    }
    
    return warehouse;
  }
  
  async getWarehouses(orgCode, filters = {}) {
    const Warehouse = mongoose.model('Warehouse');
    const query = { orgCode, ...filters };
    return Warehouse.find(query);
  }
}

class TransferPort {
  async updateTransferStatus(transferId, status) {
    const Transfer = mongoose.model('Transfer');
    return Transfer.findByIdAndUpdate(
      transferId,
      { status, updatedAt: new Date() },
      { new: true }
    );
  }
  
  async getTransfer(transferId) {
    const Transfer = mongoose.model('Transfer');
    return Transfer.findById(transferId);
  }
}

class GeocodingPort {
  async getDistance(fromCoords, toCoords) {
    const { calculateDrivingDistance } = require('../../utils/geocoding');
    
    const result = await calculateDrivingDistance(
      fromCoords[1], fromCoords[0],
      toCoords[1], toCoords[0]
    );
    
    return {
      distanceKm: result.distanceKm,
      durationHours: result.durationHours
    };
  }
}

class SettingsPort {
  async getLogisticsSettings() {
    const Settings = mongoose.model('Settings');
    const settings = await Settings.findOne({});
    
    return {
      fuelCostPerKm: settings?.logistics?.fuelCostPerKm || 150,
      laborCostPerHour: settings?.logistics?.laborCostPerHour || 500,
      fixedCostPerTrip: settings?.logistics?.fixedCostPerTrip || 1000,
      maxStopsPerRoute: settings?.logistics?.maxStopsPerRoute || 10,
      maxRouteDistanceKm: settings?.logistics?.maxRouteDistanceKm || 500,
      vehicleCapacityKg: settings?.logistics?.vehicleCapacityKg || 1000,
      dispatchDelayMinutes: settings?.logistics?.dispatchDelayMinutes || 120,
      avgTransitHours: settings?.logistics?.avgTransitHours || 24,
      ...(settings?.logistics || {})
    };
  }
}

/* -------------------------
   SIMPLE EVENT BUS (if not provided)
-------------------------- */
class SimpleEventBus {
  async emit(event) {
    console.log(`[EventBus] ${event.type}:`, event);
  }
}

/* -------------------------
   FACTORY FUNCTION
-------------------------- */
function createLogisticsService(eventBus = null) {
  const ports = {
    warehousePort: new WarehousePort(),
    transferPort: new TransferPort(),
    geocodingPort: new GeocodingPort(),
    settingsPort: new SettingsPort(),
    eventBus: eventBus || new SimpleEventBus()
  };
  
  return new LogisticsService(ports);
}

module.exports = {
  LogisticsService,
  createLogisticsService,
  WarehousePort,
  TransferPort,
  GeocodingPort,
  SettingsPort,
  SimpleEventBus
};