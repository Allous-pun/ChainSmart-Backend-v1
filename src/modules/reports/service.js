const mongoose = require('mongoose');
const PurchaseOrder = require('../inventory/purchaseOrderModel');
const PurchaseRequest = require('../inventory/purchaseRequestModel');
const StockState = require('../inventory/stockModel');
const InventoryTransaction = require('../inventory/transactionModel');
const EmissionRecord = require('../emissions/model').EmissionRecord;
const Shipment = require('../logistics/model').Shipment;
const Transfer = require('../inventory/transferModel');
const Supplier = require('../supplier/model').Supplier;
const SupplierCarbon = require('../emissions/model').SupplierCarbon;
const CostScenario = require('../costSimulation/model');
const Settings = require('../settings/model');
const OrganizationSettings = require('../organizationSettings/model');

// Helper: Get date range filters
const getDateFilter = (period, startDate, endDate) => {
  if (startDate && endDate) {
    return { createdAt: { $gte: new Date(startDate), $lte: new Date(endDate) } };
  }
  
  const now = new Date();
  const filter = {};
  
  switch (period) {
    case 'today':
      filter.createdAt = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
      break;
    case 'week':
      filter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 7)) };
      break;
    case 'month':
      filter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 30)) };
      break;
    case 'quarter':
      filter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 90)) };
      break;
    case 'year':
      filter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 365)) };
      break;
    default:
      filter.createdAt = { $gte: new Date(now.setDate(now.getDate() - 30)) };
  }
  
  return filter;
};

// Helper: Get currency
const getCurrency = async (orgCode) => {
  const orgSettings = await OrganizationSettings.findOne({ orgCode });
  return orgSettings?.region?.defaultCurrency || 'KES';
};

// ============ 1. SPEND ANALYSIS ============
const getSpendAnalysis = async (orgCode, period = 'month', startDate = null, endDate = null, groupBy = 'supplier') => {
  const dateFilter = getDateFilter(period, startDate, endDate);
  const currency = await getCurrency(orgCode);
  
  const query = { orgCode, ...dateFilter, status: { $in: ['approved', 'ordered', 'shipped', 'received'] } };
  
  const purchaseOrders = await PurchaseOrder.find(query).populate('supplierId', 'name supplierCode');
  
  let spendData = [];
  let totalSpend = 0;
  
  if (groupBy === 'supplier') {
    const supplierMap = new Map();
    purchaseOrders.forEach(po => {
      const supplierName = po.supplierId?.name || 'Unknown';
      const amount = po.totalAmount || 0;
      totalSpend += amount;
      
      if (supplierMap.has(supplierName)) {
        supplierMap.set(supplierName, supplierMap.get(supplierName) + amount);
      } else {
        supplierMap.set(supplierName, amount);
      }
    });
    
    spendData = Array.from(supplierMap.entries()).map(([name, amount]) => ({
      name,
      amount,
      percentage: 0
    }));
  } else if (groupBy === 'product') {
    const productMap = new Map();
    purchaseOrders.forEach(po => {
      po.items.forEach(item => {
        const productName = item.productId?.name || 'Unknown';
        const amount = (item.unitPrice || 0) * item.quantity;
        totalSpend += amount;
        
        if (productMap.has(productName)) {
          productMap.set(productName, productMap.get(productName) + amount);
        } else {
          productMap.set(productName, amount);
        }
      });
    });
    
    spendData = Array.from(productMap.entries()).map(([name, amount]) => ({
      name,
      amount,
      percentage: 0
    }));
  }
  
  // Calculate percentages
  spendData = spendData.map(item => ({
    ...item,
    percentage: totalSpend > 0 ? (item.amount / totalSpend) * 100 : 0
  }));
  
  spendData.sort((a, b) => b.amount - a.amount);
  
  return {
    totalSpend,
    currency,
    period,
    groupBy,
    topSpenders: spendData.slice(0, 5),
    fullData: spendData,
    orderCount: purchaseOrders.length
  };
};

// ============ 2. SUPPLIER PERFORMANCE ============
const getSupplierPerformance = async (orgCode, supplierId = null) => {
  const currency = await getCurrency(orgCode);
  
  const query = { orgCode };
  if (supplierId) query._id = supplierId;
  
  const suppliers = await Supplier.find(query);
  
  const performanceData = [];
  
  for (const supplier of suppliers) {
    // Get purchase orders for this supplier
    const purchaseOrders = await PurchaseOrder.find({
      orgCode,
      supplierId: supplier._id,
      status: { $in: ['received', 'approved'] }
    });
    
    const totalOrders = purchaseOrders.length;
    const totalSpend = purchaseOrders.reduce((sum, po) => sum + (po.totalAmount || 0), 0);
    
    // Calculate on-time delivery rate (if delivery date exists)
    const onTimeOrders = purchaseOrders.filter(po => 
      po.expectedDeliveryDate && po.actualDeliveryDate && po.actualDeliveryDate <= po.expectedDeliveryDate
    );
    const onTimeRate = totalOrders > 0 ? (onTimeOrders.length / totalOrders) * 100 : 100;
    
    // Get carbon score
    const carbon = await SupplierCarbon.findOne({ supplierId: supplier._id, orgCode });
    const carbonScore = carbon?.carbonScore || 100;
    const carbonRating = carbon?.rating || 'unknown';
    
    performanceData.push({
      supplierId: supplier._id,
      name: supplier.name,
      supplierCode: supplier.supplierCode,
      totalOrders,
      totalSpend,
      averageOrderValue: totalOrders > 0 ? totalSpend / totalOrders : 0,
      onTimeRate,
      carbonScore,
      carbonRating,
      currency
    });
  }
  
  performanceData.sort((a, b) => b.totalSpend - a.totalSpend);
  
  return {
    suppliers: performanceData,
    summary: {
      totalSuppliers: performanceData.length,
      averageOnTimeRate: performanceData.reduce((sum, s) => sum + s.onTimeRate, 0) / (performanceData.length || 1),
      averageCarbonScore: performanceData.reduce((sum, s) => sum + s.carbonScore, 0) / (performanceData.length || 1)
    }
  };
};

// ============ 3. INVENTORY TURNOVER ============
const getInventoryTurnover = async (orgCode, locationId = null) => {
  const currency = await getCurrency(orgCode);
  
  const stockQuery = { orgCode };
  if (locationId) stockQuery.locationId = locationId;
  
  const stockItems = await StockState.find(stockQuery).populate('productId', 'name sku');
  
  // Get last 12 months of transactions
  const oneYearAgo = new Date();
  oneYearAgo.setDate(oneYearAgo.getDate() - 365);
  
  const turnoverData = [];
  let totalValue = 0;
  let totalTurnover = 0;
  
  for (const stock of stockItems) {
    const outgoingTransactions = await InventoryTransaction.find({
      orgCode,
      productId: stock.productId._id,
      locationId: stock.locationId,
      type: { $in: ['OUT_SALE', 'OUT_TRANSFER'] },
      createdAt: { $gte: oneYearAgo }
    });
    
    const totalOutgoing = outgoingTransactions.reduce((sum, t) => sum + t.quantity, 0);
    const averageInventory = stock.physicalStock;
    const turnoverRatio = averageInventory > 0 ? totalOutgoing / averageInventory : 0;
    const stockValue = stock.physicalStock * (stock.averageCost || 0);
    
    totalValue += stockValue;
    totalTurnover += turnoverRatio;
    
    turnoverData.push({
      productId: stock.productId._id,
      productName: stock.productId.name,
      sku: stock.productId.sku,
      currentStock: stock.physicalStock,
      annualOutgoing: totalOutgoing,
      turnoverRatio,
      stockValue,
      locationId: stock.locationId,
      currency
    });
  }
  
  turnoverData.sort((a, b) => b.turnoverRatio - a.turnoverRatio);
  
  return {
    items: turnoverData,
    summary: {
      totalProducts: turnoverData.length,
      totalStockValue: totalValue,
      averageTurnoverRatio: turnoverData.length > 0 ? totalTurnover / turnoverData.length : 0,
      fastMoving: turnoverData.filter(t => t.turnoverRatio > 12).length,
      slowMoving: turnoverData.filter(t => t.turnoverRatio > 0 && t.turnoverRatio < 2).length,
      deadStock: turnoverData.filter(t => t.turnoverRatio === 0).length,
      currency
    }
  };
};

// ============ 4. WASTE TRENDS ============
const getWasteTrends = async (orgCode, locationId = null, period = 'month') => {
  const dateFilter = getDateFilter(period);
  const currency = await getCurrency(orgCode);
  
  const wasteQuery = {
    orgCode,
    type: 'OUT_ADJUSTMENT',
    reason: { $in: ['waste', 'expired', 'damaged', 'spoilage'] },
    ...dateFilter
  };
  if (locationId) wasteQuery.locationId = locationId;
  
  const wasteTransactions = await InventoryTransaction.find(wasteQuery).populate('productId', 'name sku');
  
  const totalWasteQuantity = wasteTransactions.reduce((sum, t) => sum + t.quantity, 0);
  const totalWasteValue = wasteTransactions.reduce((sum, t) => sum + (t.totalCost || 0), 0);
  
  const byReason = {};
  const byProduct = {};
  
  wasteTransactions.forEach(t => {
    // By reason
    byReason[t.reason] = (byReason[t.reason] || 0) + t.quantity;
    
    // By product
    const productName = t.productId?.name || 'Unknown';
    byProduct[productName] = (byProduct[productName] || 0) + t.quantity;
  });
  
  // Daily trend for chart
  const dailyTrend = {};
  wasteTransactions.forEach(t => {
    const date = t.createdAt.toISOString().split('T')[0];
    dailyTrend[date] = (dailyTrend[date] || 0) + t.quantity;
  });
  
  return {
    totalWasteQuantity,
    totalWasteValue,
    currency,
    period,
    byReason: Object.entries(byReason).map(([reason, quantity]) => ({ reason, quantity })),
    byProduct: Object.entries(byProduct).map(([product, quantity]) => ({ product, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 10),
    dailyTrend: Object.entries(dailyTrend).map(([date, quantity]) => ({ date, quantity })),
    transactionCount: wasteTransactions.length
  };
};

// ============ 5. SAVINGS REPORT ============
const getSavingsReport = async (orgCode, period = 'month') => {
  const dateFilter = getDateFilter(period);
  const currency = await getCurrency(orgCode);
  
  // Get cost simulation scenarios
  const scenarios = await CostScenario.find({
    orgCode,
    createdAt: dateFilter.createdAt,
    isActive: true
  });
  
  const savingsFromScenarios = scenarios.reduce((sum, s) => {
    const bestSavings = s.results?.comparisons?.reduce((max, c) => Math.max(max, c.savings || 0), 0) || 0;
    return sum + bestSavings;
  }, 0);
  
  // Get purchase orders that were optimized
  const purchaseOrders = await PurchaseOrder.find({
    orgCode,
    ...dateFilter,
    source: 'auto_optimizer'
  });
  
  const optimizedPOs = purchaseOrders.length;
  const optimizedSpend = purchaseOrders.reduce((sum, po) => sum + (po.totalAmount || 0), 0);
  
  return {
    totalSavings: savingsFromScenarios,
    currency,
    period,
    details: {
      fromCostScenarios: savingsFromScenarios,
      optimizedPurchaseOrders: optimizedPOs,
      optimizedSpend,
      estimatedSavingsPercent: optimizedSpend > 0 ? (savingsFromScenarios / optimizedSpend) * 100 : 0
    },
    scenarios: scenarios.map(s => ({
      name: s.name,
      savings: s.results?.comparisons?.reduce((max, c) => Math.max(max, c.savings || 0), 0) || 0,
      createdAt: s.createdAt
    }))
  };
};

// ============ 6. EMISSIONS SUMMARY ============
const getEmissionsSummary = async (orgCode, period = 'month') => {
  const dateFilter = getDateFilter(period);
  const settings = await Settings.findOne({ orgCode });
  const reportingUnit = settings?.emissions?.reportingUnit || 'kg';
  
  const emissions = await EmissionRecord.find({
    orgCode,
    calculatedAt: dateFilter.createdAt
  });
  
  const totalCO2 = emissions.reduce((sum, e) => sum + e.co2Emitted, 0);
  const byType = {
    shipment: emissions.filter(e => e.referenceType === 'shipment').reduce((s, e) => s + e.co2Emitted, 0),
    transfer: emissions.filter(e => e.referenceType === 'transfer').reduce((s, e) => s + e.co2Emitted, 0),
    purchase_order: emissions.filter(e => e.referenceType === 'purchase_order').reduce((s, e) => s + e.co2Emitted, 0)
  };
  
  // Monthly trend
  const monthlyTrend = {};
  emissions.forEach(e => {
    const month = e.calculatedAt.toISOString().slice(0, 7);
    monthlyTrend[month] = (monthlyTrend[month] || 0) + e.co2Emitted;
  });
  
  return {
    totalCO2,
    unit: reportingUnit,
    period,
    byType,
    monthlyTrend: Object.entries(monthlyTrend).map(([month, co2]) => ({ month, co2 })),
    recordCount: emissions.length
  };
};

// ============ 7. LOGISTICS PERFORMANCE ============
const getLogisticsPerformance = async (orgCode, period = 'month') => {
  const dateFilter = getDateFilter(period);
  const currency = await getCurrency(orgCode);
  
  const shipments = await Shipment.find({ orgCode, ...dateFilter });
  const transfers = await Transfer.find({ orgCode, createdAt: dateFilter.createdAt });
  
  const totalShipments = shipments.length;
  const deliveredShipments = shipments.filter(s => s.status === 'delivered').length;
  const onTimeShipments = shipments.filter(s => s.performanceMetrics?.onTimeDelivery === true).length;
  
  const totalTransfers = transfers.length;
  const completedTransfers = transfers.filter(t => t.status === 'received').length;
  
  const totalDistance = [...shipments, ...transfers].reduce((sum, item) => sum + (item.totalDistanceKm || item.distanceKm || 0), 0);
  const totalCost = shipments.reduce((sum, s) => sum + (s.costSnapshot?.totalCost || 0), 0);
  
  return {
    shipments: {
      total: totalShipments,
      delivered: deliveredShipments,
      onTimeDeliveryRate: totalShipments > 0 ? (onTimeShipments / totalShipments) * 100 : 100,
      deliveryRate: totalShipments > 0 ? (deliveredShipments / totalShipments) * 100 : 0
    },
    transfers: {
      total: totalTransfers,
      completed: completedTransfers,
      completionRate: totalTransfers > 0 ? (completedTransfers / totalTransfers) * 100 : 100
    },
    logistics: {
      totalDistanceKm: totalDistance,
      totalCost,
      averageCostPerKm: totalDistance > 0 ? totalCost / totalDistance : 0,
      currency
    },
    period
  };
};

// ============ 8. DASHBOARD (All Metrics) ============
const getDashboard = async (orgCode, period = 'month') => {
  const [spend, supplierPerformance, inventoryTurnover, waste, savings, emissions, logistics] = await Promise.all([
    getSpendAnalysis(orgCode, period),
    getSupplierPerformance(orgCode),
    getInventoryTurnover(orgCode),
    getWasteTrends(orgCode, null, period),
    getSavingsReport(orgCode, period),
    getEmissionsSummary(orgCode, period),
    getLogisticsPerformance(orgCode, period)
  ]);
  
  const currency = await getCurrency(orgCode);
  
  return {
    period,
    currency,
    spend: {
      total: spend.totalSpend,
      topSuppliers: spend.topSpenders
    },
    suppliers: {
      total: supplierPerformance.suppliers.length,
      averageOnTimeRate: supplierPerformance.summary.averageOnTimeRate,
      averageCarbonScore: supplierPerformance.summary.averageCarbonScore
    },
    inventory: {
      totalStockValue: inventoryTurnover.summary.totalStockValue,
      averageTurnoverRatio: inventoryTurnover.summary.averageTurnoverRatio,
      deadStock: inventoryTurnover.summary.deadStock
    },
    waste: {
      totalQuantity: waste.totalWasteQuantity,
      totalValue: waste.totalWasteValue
    },
    savings: {
      total: savings.totalSavings,
      optimizedOrders: savings.details.optimizedPurchaseOrders
    },
    emissions: {
      totalCO2: emissions.totalCO2,
      unit: emissions.unit,
      byType: emissions.byType
    },
    logistics: {
      onTimeDeliveryRate: logistics.shipments.onTimeDeliveryRate,
      totalDistanceKm: logistics.logistics.totalDistanceKm
    }
  };
};

module.exports = {
  getSpendAnalysis,
  getSupplierPerformance,
  getInventoryTurnover,
  getWasteTrends,
  getSavingsReport,
  getEmissionsSummary,
  getLogisticsPerformance,
  getDashboard
};