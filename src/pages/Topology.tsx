/** 拓扑图页面 - 使用 Cytoscape.js + dagre 分层布局 + 网口复合节点 */
import { useState, useEffect, useRef, useCallback } from 'react';
import cytoscape from 'cytoscape';
import cytoscapeDagre from 'cytoscape-dagre';
import { useStorageDriver } from '../hooks/useStorage';
import { useApp } from '../context/AppContext';
import { Modal } from '../components/Modal';
import type { Entity, Edge, SwitchPort, AutoVLANResult, NetworkInterface, ValidationReport } from '../types';
import { CATEGORY_LABELS } from '../types';
import { VLANPathValidator } from '../components/VLANPathValidator';
import { RefreshCw, Link, ShieldCheck, Trash2, Edit, ArrowLeftRight, Route } from 'lucide-react';
import { iconToDataUrl, getDefaultIcon } from '../utils/iconToDataUrl';

// 注册 dagre 布局扩展
cytoscape.use(cytoscapeDagre);

// 节点颜色映射
const CATEGORY_COLORS: Record<string, string> = {
  switch: '#3b82f6', router: '#10b981', ont: '#f59e0b',
  server: '#6366f1', pc: '#8b5cf6', phone: '#ec4899',
  iot: '#14b8a6', camera: '#f97316', ap: '#06b6d4', ac: '#0891b2',
  vm: '#a855f7', hypervisor: '#7c3aed', nas: '#ea580c', san: '#dc2626',
  disk: '#78716c', container: '#e11d48', service: '#db2777',
  application: '#be185d', ssid: '#a78bfa',
};

// 设备类型默认层级优先级（仅作为无连接时的 fallback）
const DEFAULT_TIER: Record<string, number> = {
  ont: 0,           // 光猫 - 最顶层
  router: 1,        // 主路由
  switch: 2,        // 交换机
  ac: 3, ap: 3,    // AC、AP
  server: 3, nas: 3, san: 3, hypervisor: 3, // 有线连接设备同层
  pc: 3, camera: 3, // 有线终端
  ssid: 4,          // WiFi 热点
  phone: 6, iot: 6, vm: 6, // 无线设备（留出间隙给推算）
  disk: 6, container: 6, service: 6, application: 6,
};

/**
 * 基于链接关系计算每个节点的实际层级
 *
 * 规则：
 * 1. 不同类型设备按 DEFAULT_TIER 分层（光猫>路由>交换机>AC/AP>SSID>终端）
 * 2. 信任边方向：source_id = 上级, target_id = 下级（后端已规范化）
 * 3. BFS 下推：确保每条边的 target depth > source depth
 */
function computeTopologyDepth(
  nodeList: Entity[],
  edgeList: Edge[],
): Map<string, number> {
  const depthMap = new Map<string, number>();
  if (nodeList.length === 0) return depthMap;

  // 初始化：每个节点用 DEFAULT_TIER 作为基础层级
  for (const n of nodeList) {
    depthMap.set(n.id, DEFAULT_TIER[n.category] ?? 5);
  }

  const hierarchyEdgeTypes = new Set(['physical', 'logical', 'management', 'wireless']);

  // 构建有向图（直接信任边方向：source→target = 上级→下级）
  const children = new Map<string, Set<string>>();
  for (const n of nodeList) children.set(n.id, new Set());
  for (const e of edgeList) {
    if (!hierarchyEdgeTypes.has(e.edge_type)) continue;
    children.get(e.source_id)?.add(e.target_id);
  }

  // BFS 下推层级：确保 child.depth > parent.depth
  const sortedNodes = [...nodeList].sort((a, b) =>
    (DEFAULT_TIER[a.category] ?? 5) - (DEFAULT_TIER[b.category] ?? 5)
  );

  for (const n of sortedNodes) {
    const childSet = children.get(n.id);
    if (!childSet || childSet.size === 0) continue;
    const myDepth = depthMap.get(n.id) ?? 5;
    for (const cid of childSet) {
      if ((depthMap.get(cid) ?? 5) <= myDepth) {
        depthMap.set(cid, myDepth + 1);
      }
    }
  }

  // 多轮传播确保级联关系正确（如 A→B→C 时 C 需要再推一次）
  let changed = true;
  let iterations = 0;
  while (changed && iterations < 20) {
    changed = false;
    iterations++;
    for (const e of edgeList) {
      if (!hierarchyEdgeTypes.has(e.edge_type)) continue;
      const srcDepth = depthMap.get(e.source_id);
      const tgtDepth = depthMap.get(e.target_id);
      if (srcDepth !== undefined && tgtDepth !== undefined && tgtDepth <= srcDepth) {
        depthMap.set(e.target_id, srcDepth + 1);
        changed = true;
      }
    }
  }

  return depthMap;
}

// 连接器类型颜色
const CONNECTOR_COLORS: Record<string, string> = {
  rj45: '#d97706',     // 琥珀色
  sfp: '#2563eb',      // 蓝色
  sfp_plus: '#1d4ed8', // 深蓝
  wifi: '#8b5cf6',     // 紫色
};

export function Topology() {
  const { showToast } = useApp();
  const driver = useStorageDriver();
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<cytoscape.Core | null>(null);

  const [nodes, setNodes] = useState<Entity[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [interfaces, setInterfaces] = useState<NetworkInterface[]>([]);
  const [containment, setContainment] = useState<Array<{ child_id: string; parent_id: string; relation: string }>>([]);
  const [selectedNode, setSelectedNode] = useState<Entity | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<Edge | null>(null);
  const [selectedPort, setSelectedPort] = useState<NetworkInterface | null>(null);

  // 连线表单
  const [showLinkForm, setShowLinkForm] = useState(false);
  const [linkSource, setLinkSource] = useState('');
  const [linkTarget, setLinkTarget] = useState('');
  const [linkSourcePort, setLinkSourcePort] = useState('');
  const [linkTargetPort, setLinkTargetPort] = useState('');
  const [linkType, setLinkType] = useState<'physical' | 'logical' | 'wireless' | 'management'>('physical');
  const [autoResult, setAutoResult] = useState<AutoVLANResult | null>(null);

  // 端口信息
  const [sourcePorts, setSourcePorts] = useState<SwitchPort[]>([]);
  const [targetPorts, setTargetPorts] = useState<SwitchPort[]>([]);

  // 网口选择
  const [sourceInterfaces, setSourceInterfaces] = useState<NetworkInterface[]>([]);
  const [targetInterfaces, setTargetInterfaces] = useState<NetworkInterface[]>([]);
  const [linkSourceIface, setLinkSourceIface] = useState('');
  const [linkTargetIface, setLinkTargetIface] = useState('');
  const [compatMessage, setCompatMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 验证报告
  const [showValidation, setShowValidation] = useState(false);
  const [validationReport] = useState<ValidationReport | null>(null);
  const [validating, setValidating] = useState(false);

  // VLAN 路径验证面板
  const [showVlanValidator, setShowVlanValidator] = useState(false);

  // 编辑链路
  const [showEditLink, setShowEditLink] = useState(false);
  const [editEdge, setEditEdge] = useState<Edge | null>(null);
  const [editSourceIface, setEditSourceIface] = useState('');
  const [editTargetIface, setEditTargetIface] = useState('');
  const [editSourcePort, setEditSourcePort] = useState('');
  const [editTargetPort, setEditTargetPort] = useState('');
  const [editLinkType, setEditLinkType] = useState<'physical' | 'logical'>('physical');
  const [editSourceInterfaces, setEditSourceInterfaces] = useState<NetworkInterface[]>([]);
  const [editTargetInterfaces, setEditTargetInterfaces] = useState<NetworkInterface[]>([]);
  const [editSourcePorts, setEditSourcePorts] = useState<SwitchPort[]>([]);
  const [editTargetPorts, setEditTargetPorts] = useState<SwitchPort[]>([]);
  const [editCompatMessage, setEditCompatMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 无线连接 SSID 选择
  const [targetSSIDs, setTargetSSIDs] = useState<Array<{ id: string; ssid_name: string; vlan_id: number | null; vlan_name?: string }>>([]);
  const [linkSSID, setLinkSSID] = useState('');

  const loadTopology = useCallback(async () => {
    // 获取所有实体和边
    const entitiesResult = await driver.getEntities(undefined, { page: 1, pageSize: 1000 });
    const edgesData = await driver.getEdges();

    setNodes(entitiesResult.data);
    setEdges(edgesData.map(e => ({
      ...e,
      metadata: typeof e.metadata === 'string' ? JSON.parse(e.metadata) : (e.metadata || {}),
    })));

    // 收集所有实体的网口
    const allInterfaces: NetworkInterface[] = [];
    for (const entity of entitiesResult.data) {
      const ifaces = await driver.getNetworkInterfaces(entity.id);
      allInterfaces.push(...ifaces);
    }
    setInterfaces(allInterfaces);
    // TODO: 需要从某处获取 containment 关系数据
    setContainment([]);
  }, [driver]);

  useEffect(() => { loadTopology(); }, [loadTopology]);

  // 构建 Cytoscape 元素：复合节点（设备+端口）+ 包含关系
  const buildElements = useCallback(() => {
    // 找出哪些网口被边使用（只显示有连接的端口）
    const usedIfaceIds = new Set<string>();
    for (const e of edges) {
      if (e.source_interface_id) usedIfaceIds.add(e.source_interface_id);
      if (e.target_interface_id) usedIfaceIds.add(e.target_interface_id);
    }

    // 基于链接关系计算实际层级
    const depthMap = computeTopologyDepth(nodes, edges);

    // 构建包含关系映射
    const parentMap = new Map<string, string>(); // child_id -> parent_id
    const nodeIdSet = new Set(nodes.map(n => n.id));
    for (const c of containment) {
      if (nodeIdSet.has(c.parent_id) && nodeIdSet.has(c.child_id)) {
        parentMap.set(c.child_id, c.parent_id);
      }
    }
    // 标记宿主节点
    const hostIds = new Set(parentMap.values());

    const elements: cytoscape.ElementDefinition[] = [];

    // 添加设备父节点
    for (const n of nodes) {
      const tier = depthMap.get(n.id) ?? (DEFAULT_TIER[n.category] ?? 3);
      const meta = typeof n.metadata === 'string' ? JSON.parse(n.metadata) : (n.metadata || {});
      const iconName = (meta as Record<string, unknown>)?.icon as string || getDefaultIcon(n.category);
      const color = CATEGORY_COLORS[n.category] || '#475569';
      const nodeIconUrl = iconToDataUrl(iconName, color);

      const nodeData: Record<string, unknown> = {
        id: n.id, label: n.name, category: n.category, type: n.type,
        tier, isDevice: 'true', iconUrl: nodeIconUrl,
        isHost: hostIds.has(n.id) ? 'true' : 'false',
      };

      // 设置包含关系的 parent
      if (parentMap.has(n.id)) {
        nodeData.parent = parentMap.get(n.id);
      }

      elements.push({ data: nodeData });
    }

    // 添加端口子节点（只添加被使用的）
    const ifacesByEntity = new Map<string, NetworkInterface[]>();
    for (const iface of interfaces) {
      if (!usedIfaceIds.has(iface.id)) continue;
      const list = ifacesByEntity.get(iface.entity_id) || [];
      list.push(iface);
      ifacesByEntity.set(iface.entity_id, list);
    }

    for (const [entityId, ifaces] of ifacesByEntity) {
      for (const iface of ifaces) {
        elements.push({
          data: {
            id: `${entityId}__port__${iface.id}`,
            parent: entityId,
            label: iface.nic_name,
            isPort: 'true',
            connectorType: iface.connector_type || 'rj45',
            mediaType: iface.media_type,
            ifaceId: iface.id,
          },
        });
      }
    }

    // 添加边：连接到端口节点（如果有网口信息）
    for (const e of edges) {
      const srcId = e.source_id;
      const tgtId = e.target_id;
      const srcIfaceId = e.source_interface_id;
      const tgtIfaceId = e.target_interface_id;

      const sourceNode = srcIfaceId && usedIfaceIds.has(srcIfaceId)
        ? `${srcId}__port__${srcIfaceId}` : srcId;
      const targetNode = tgtIfaceId && usedIfaceIds.has(tgtIfaceId)
        ? `${tgtId}__port__${tgtIfaceId}` : tgtId;

      // 生成端口标签
      let portLabel = '';
      if (e.source_interface_id || e.target_interface_id) {
        const srcIface = interfaces.find(i => i.id === e.source_interface_id);
        const tgtIface = interfaces.find(i => i.id === e.target_interface_id);
        if (srcIface && tgtIface) portLabel = `${srcIface.nic_name} ↔ ${tgtIface.nic_name}`;
        else if (srcIface) portLabel = srcIface.nic_name;
        else if (tgtIface) portLabel = tgtIface.nic_name;
      }

      elements.push({
        data: {
          id: e.id,
          source: sourceNode,
          target: targetNode,
          edgeType: e.edge_type,
          portLabel,
          sourceEntityId: e.source_id,
          targetEntityId: e.target_id,
        },
      });
    }

    return elements;
  }, [nodes, edges, interfaces, containment]);

  // 初始化 Cytoscape
  useEffect(() => {
    if (!containerRef.current) return;
    if (cyRef.current) { cyRef.current.destroy(); cyRef.current = null; }
    if (nodes.length === 0) return;

    const elements = buildElements();

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        // 普通设备节点：圆角矩形，icon+label 内部居中
        {
          selector: 'node[isDevice = "true"][isHost = "false"]',
          style: {
            'shape': 'round-rectangle',
            'label': 'data(label)',
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': -6,
            'font-size': '10px',
            'width': 80,
            'height': 56,
            'background-color': '#f8fafc',
            'background-opacity': 0.95,
            'border-width': 2,
            'border-color': '#e2e8f0',
            'color': '#334155',
            'background-image': 'data(iconUrl)',
            'background-width': '24px',
            'background-height': '24px',
            'background-position-y': '35%',
            'background-clip': 'none',
            'padding': '4px',
          } as cytoscape.Css.Node,
        },
        // 宿主容器节点（有包含子节点）：虚线边框，icon+label 顶部
        {
          selector: 'node[isHost = "true"]',
          style: {
            'shape': 'round-rectangle',
            'label': 'data(label)',
            'text-valign': 'top',
            'text-halign': 'center',
            'text-margin-y': -4,
            'font-size': '10px',
            'font-weight': 'bold',
            'min-width': '140',
            'min-height': '90',
            'background-color': '#f1f5f9',
            'background-opacity': 0.5,
            'border-width': 2,
            'border-style': 'dashed',
            'border-color': '#94a3b8',
            'color': '#1e293b',
            'background-image': 'data(iconUrl)',
            'background-width': '20px',
            'background-height': '20px',
            'background-position-x': '50%',
            'background-position-y': '6px',
            'background-clip': 'none',
            'padding': '24px',
          } as cytoscape.Css.Node,
        },
        // 根据类别设置设备边框颜色（普通节点）
        ...Object.entries(CATEGORY_COLORS).map(([cat, color]) => ({
          selector: `node[isDevice = "true"][isHost = "false"][category = "${cat}"]`,
          style: {
            'border-color': color,
            'border-width': 2.5,
            'background-color': color,
            'background-opacity': 0.08,
          } as cytoscape.Css.Node,
        })),
        // 根据类别设置宿主容器边框颜色
        ...Object.entries(CATEGORY_COLORS).map(([cat, color]) => ({
          selector: `node[isHost = "true"][category = "${cat}"]`,
          style: {
            'border-color': color,
          } as cytoscape.Css.Node,
        })),
        // SSID 虚拟节点：菱形
        {
          selector: 'node[category = "ssid"]',
          style: {
            'shape': 'diamond',
            'width': 36,
            'height': 36,
            'border-color': '#7c3aed',
            'background-color': '#a78bfa',
            'background-opacity': 0.15,
            'font-size': '10px',
          } as cytoscape.Css.Node,
        },
        // 端口子节点：小方块
        {
          selector: 'node[isPort = "true"]',
          style: {
            'shape': 'rectangle',
            'width': 12,
            'height': 10,
            'label': 'data(label)',
            'font-size': '7px',
            'text-valign': 'bottom',
            'text-margin-y': 3,
            'color': '#64748b',
            'background-color': '#d97706',
            'border-width': 1,
            'border-color': '#92400e',
          } as cytoscape.Css.Node,
        },
        // 端口颜色按连接器类型
        ...Object.entries(CONNECTOR_COLORS).map(([ct, color]) => ({
          selector: `node[connectorType = "${ct}"]`,
          style: { 'background-color': color, 'border-color': color } as cytoscape.Css.Node,
        })),
        // 物理连接：弧线（避免折线重叠）
        {
          selector: 'edge[edgeType = "physical"]',
          style: {
            'width': 2.5,
            'line-color': '#475569',
            'curve-style': 'unbundled-bezier',
            'control-point-distances': [40],
            'control-point-weights': [0.5],
            'target-arrow-shape': 'none',
            'label': 'data(portLabel)',
            'font-size': '8px',
            'text-background-color': '#ffffff',
            'text-background-opacity': 1,
            'text-background-padding': '2px',
            'color': '#64748b',
          } as cytoscape.Css.Edge,
        },
        // 逻辑连接
        {
          selector: 'edge[edgeType = "logical"]',
          style: {
            'width': 2,
            'line-color': '#94a3b8',
            'curve-style': 'unbundled-bezier',
            'control-point-distances': [30],
            'control-point-weights': [0.5],
            'target-arrow-shape': 'none',
          } as cytoscape.Css.Edge,
        },
        // VLAN 成员
        {
          selector: 'edge[edgeType = "vlan_member"]',
          style: {
            'width': 2,
            'line-style': 'dashed',
            'line-color': '#3b82f6',
            'curve-style': 'unbundled-bezier',
            'control-point-distances': [30],
            'control-point-weights': [0.5],
            'target-arrow-shape': 'none',
          } as cytoscape.Css.Edge,
        },
        // 无线连接
        {
          selector: 'edge[edgeType = "wireless"]',
          style: {
            'width': 2,
            'line-style': 'dashed',
            'line-color': '#8b5cf6',
            'line-dash-pattern': [6, 3],
            'curve-style': 'unbundled-bezier',
            'control-point-distances': [30],
            'control-point-weights': [0.5],
            'target-arrow-shape': 'none',
          } as unknown as cytoscape.Css.Edge,
        },
        // 管理连接
        {
          selector: 'edge[edgeType = "management"]',
          style: {
            'width': 2,
            'line-style': 'dotted',
            'line-color': '#f59e0b',
            'curve-style': 'unbundled-bezier',
            'control-point-distances': [30],
            'control-point-weights': [0.5],
            'target-arrow-shape': 'none',
          } as cytoscape.Css.Edge,
        },
        // 选中态
        {
          selector: 'node:selected',
          style: { 'border-width': 3, 'border-color': '#2563eb', 'overlay-opacity': 0.1 } as cytoscape.Css.Node,
        },
        {
          selector: 'edge:selected',
          style: { 'width': 4, 'line-color': '#ef4444', 'overlay-opacity': 0.1 } as cytoscape.Css.Edge,
        },
      ],
      // 先不运行布局，手动触发后再调整位置
      layout: { name: 'preset' },
    });

    // 手动运行 dagre 布局
    const layout = cy.layout({
      name: nodes.length <= 1 ? 'grid' : 'dagre',
      rankDir: 'TB',
      rankSep: 120,
      nodeSep: 60,
      edgeSep: 20,
      animate: false,
      padding: 50,
      // 按 tier 排序
      sort: (a: cytoscape.NodeSingular, b: cytoscape.NodeSingular) => {
        return (a.data('tier') || 0) - (b.data('tier') || 0);
      },
    } as cytoscape.LayoutOptions);
    layout.run();

    // dagre 同步布局完成后，强制根据 tier 调整 Y 坐标（仅顶层设备节点）
    const tierGroups = new Map<number, cytoscape.NodeSingular[]>();
    cy.nodes('[isDevice = "true"]').forEach(node => {
      // 只对顶层节点（无 parent 或 parent 不是设备）调整 tier Y
      if (node.data('parent') && cy.getElementById(node.data('parent')).data('isDevice') === 'true') return;
      const tier = node.data('tier') ?? 6;
      const list = tierGroups.get(tier) || [];
      list.push(node);
      tierGroups.set(tier, list);
    });

    const sortedTiers = Array.from(tierGroups.keys()).sort((a, b) => a - b);
    if (sortedTiers.length > 0) {
      const RANK_SEP = 140;
      const startY = 50;
      const tierY = new Map<number, number>();
      sortedTiers.forEach((tier, idx) => {
        tierY.set(tier, startY + idx * RANK_SEP);
      });

      cy.nodes('[isDevice = "true"]').forEach(node => {
        if (node.data('parent') && cy.getElementById(node.data('parent')).data('isDevice') === 'true') return;
        const tier = node.data('tier') ?? 6;
        const targetY = tierY.get(tier) ?? node.position('y');
        node.position('y', targetY);
      });
    }

    // 定位端口子节点到父节点底部（只选择端口节点）
    cy.nodes('[isDevice = "true"]').forEach(parent => {
      const ports = parent.children('[isPort = "true"]');
      if (ports.length === 0) return;
      const bb = parent.boundingBox();
      const count = ports.length;
      ports.forEach((port, i) => {
        port.position({
          x: bb.x1 + (bb.w / (count + 1)) * (i + 1),
          y: bb.y2 - 4,
        });
      });
    });
    cy.nodes('[isPort = "true"]').lock();
    cy.fit(undefined, 50);

    // 事件处理
    cy.on('tap', 'node[isDevice = "true"]', (evt) => {
      const nodeId = evt.target.id();
      const entity = nodes.find(n => n.id === nodeId);
      if (entity) { setSelectedNode(entity); setSelectedEdge(null); setSelectedPort(null); }
    });

    cy.on('tap', 'node[isPort = "true"]', (evt) => {
      const ifaceId = evt.target.data('ifaceId');
      const iface = interfaces.find(i => i.id === ifaceId);
      if (iface) { setSelectedPort(iface); setSelectedNode(null); setSelectedEdge(null); }
    });

    cy.on('tap', 'edge', (evt) => {
      const edgeId = evt.target.id();
      const edge = edges.find(e => e.id === edgeId);
      if (edge) { setSelectedEdge(edge); setSelectedNode(null); setSelectedPort(null); }
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) { setSelectedNode(null); setSelectedEdge(null); setSelectedPort(null); }
    });

    cyRef.current = cy;
    return () => { cy.destroy(); };
  }, [nodes, edges, interfaces, buildElements]);

  // 加载端口和网口信息
  const loadPorts = async (entityId: string, setFn: (ports: SwitchPort[]) => void, setIfaceFn: (ifaces: NetworkInterface[]) => void) => {
    const entity = nodes.find(n => n.id === entityId);
    // TODO: 需要在 StorageDriver 中添加 getSwitchPorts 方法或类似的接口
    // 暂时使用空数组，需要后续扩展 driver
    if (entity?.category === 'switch') {
      // const ports = await driver.getSwitchPorts(entityId);
      // setFn(ports);
      setFn([]);
    } else {
      setFn([]);
    }
    const ifaces = await driver.getNetworkInterfaces(entityId);
    setIfaceFn(ifaces);
  };

  // 兼容性实时预检
  const checkCompat = (srcId: string, tgtId: string) => {
    const src = sourceInterfaces.find(i => i.id === srcId);
    const tgt = targetInterfaces.find(i => i.id === tgtId);
    if (!src || !tgt) { setCompatMessage(null); return; }
    if (src.media_type === 'wifi' || tgt.media_type === 'wifi') {
      setCompatMessage({ ok: false, text: '无线网卡不支持物理链路' }); return;
    }
    if (src.connector_type && tgt.connector_type) {
      const sfpFamily = ['sfp', 'sfp_plus'];
      const compatible = src.connector_type === tgt.connector_type ||
        (sfpFamily.includes(src.connector_type) && sfpFamily.includes(tgt.connector_type));
      if (!compatible) {
        setCompatMessage({ ok: false, text: `连接器不兼容: ${src.connector_type} ↔ ${tgt.connector_type}` }); return;
      }
    }
    if (src.speed && tgt.speed && src.speed !== tgt.speed) {
      setCompatMessage({ ok: true, text: `速率不同 (${src.speed} ↔ ${tgt.speed})，将以较低速率运行` }); return;
    }
    setCompatMessage({ ok: true, text: '✓ 兼容' });
  };

  // 运行验证
  const runValidation = async () => {
    setValidating(true);
    try {
      // TODO: 需要在 StorageDriver 中添加验证方法
      // const report = await driver.validatePhysicalLinks();
      // 暂时不显示验证结果
      showToast('验证功能待实现', 'info');
    } catch (e) {
      showToast(e instanceof Error ? e.message : '验证失败', 'error');
    }
    setValidating(false);
  };

  // 删除链路
  const handleDeleteEdge = async (edgeId: string) => {
    if (!confirm('确定删除该链路？')) return;
    try {
      await driver.deleteEdge(edgeId);
      showToast('链路已删除', 'success');
      setSelectedEdge(null);
      loadTopology();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '删除失败', 'error');
    }
  };

  // 打开编辑链路 Modal
  const openEditLink = async (edge: Edge) => {
    setEditEdge(edge);
    setEditSourceIface(edge.source_interface_id || '');
    setEditTargetIface(edge.target_interface_id || '');
    setEditSourcePort(edge.source_port != null ? String(edge.source_port) : '');
    setEditTargetPort(edge.target_port != null ? String(edge.target_port) : '');
    setEditLinkType(edge.edge_type === 'logical' ? 'logical' : 'physical');
    setEditCompatMessage(null);

    const srcIfaces = await driver.getNetworkInterfaces(edge.source_id);
    setEditSourceInterfaces(srcIfaces);
    const tgtIfaces = await driver.getNetworkInterfaces(edge.target_id);
    setEditTargetInterfaces(tgtIfaces);

    const srcEntity = nodes.find(n => n.id === edge.source_id);
    const tgtEntity = nodes.find(n => n.id === edge.target_id);
    // TODO: 需要在 StorageDriver 中添加 getSwitchPorts 方法
    if (srcEntity?.category === 'switch') {
      // const ports = await driver.getSwitchPorts(edge.source_id);
      // setEditSourcePorts(ports);
      setEditSourcePorts([]);
    } else { setEditSourcePorts([]); }
    if (tgtEntity?.category === 'switch') {
      // const ports = await driver.getSwitchPorts(edge.target_id);
      // setEditTargetPorts(ports);
      setEditTargetPorts([]);
    } else { setEditTargetPorts([]); }

    setShowEditLink(true);
  };

  // 编辑兼容性预检
  const checkEditCompat = (srcId: string, tgtId: string) => {
    const src = editSourceInterfaces.find(i => i.id === srcId);
    const tgt = editTargetInterfaces.find(i => i.id === tgtId);
    if (!src || !tgt) { setEditCompatMessage(null); return; }
    if (src.media_type === 'wifi' || tgt.media_type === 'wifi') {
      setEditCompatMessage({ ok: false, text: '无线网卡不支持物理链路' }); return;
    }
    if (src.connector_type && tgt.connector_type) {
      const sfpFamily = ['sfp', 'sfp_plus'];
      const compatible = src.connector_type === tgt.connector_type ||
        (sfpFamily.includes(src.connector_type) && sfpFamily.includes(tgt.connector_type));
      if (!compatible) {
        setEditCompatMessage({ ok: false, text: `连接器不兼容: ${src.connector_type} ↔ ${tgt.connector_type}` }); return;
      }
    }
    if (src.speed && tgt.speed && src.speed !== tgt.speed) {
      setEditCompatMessage({ ok: true, text: `速率不同 (${src.speed} ↔ ${tgt.speed})，将以较低速率运行` }); return;
    }
    setEditCompatMessage({ ok: true, text: '✓ 兼容' });
  };

  // 保存编辑
  const handleSaveEditLink = async () => {
    if (!editEdge) return;
    try {
      const updatedEdge: Edge = {
        ...editEdge,
        source_port: editSourcePort ? parseInt(editSourcePort) : null,
        target_port: editTargetPort ? parseInt(editTargetPort) : null,
        source_interface_id: editSourceIface || null,
        target_interface_id: editTargetIface || null,
        edge_type: editLinkType as any,
      };
      await driver.saveEdge(updatedEdge);
      showToast('链路已更新', 'success');
      setShowEditLink(false);
      setSelectedEdge(null);
      loadTopology();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '更新失败', 'error');
    }
  };

  // 交换链路方向
  const handleReverseEdge = async () => {
    if (!editEdge) return;
    try {
      const reversedEdge: Edge = {
        ...editEdge,
        source_id: editEdge.target_id,
        target_id: editEdge.source_id,
        source_interface_id: editEdge.target_interface_id,
        target_interface_id: editEdge.source_interface_id,
        source_port: editEdge.target_port,
        target_port: editEdge.source_port,
      };
      await driver.saveEdge(reversedEdge);
      showToast('链路方向已交换', 'success');
      setShowEditLink(false);
      setSelectedEdge(null);
      loadTopology();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '交换方向失败', 'error');
    }
  };

  const openLinkForm = () => {
    setLinkSource(''); setLinkTarget('');
    setLinkSourcePort(''); setLinkTargetPort('');
    setLinkSourceIface(''); setLinkTargetIface('');
    setLinkType('physical'); setAutoResult(null);
    setSourcePorts([]); setTargetPorts([]);
    setSourceInterfaces([]); setTargetInterfaces([]);
    setCompatMessage(null); setTargetSSIDs([]); setLinkSSID('');
    setShowLinkForm(true);
  };

  const handleCreateLink = async () => {
    if (!linkSource || !linkTarget) { showToast('请选择源和目标', 'error'); return; }
    if (linkType === 'wireless' && !linkSSID) { showToast('请选择 SSID', 'error'); return; }
    try {
      const newEdge: Edge = {
        id: crypto.randomUUID(),
        source_id: linkSource,
        target_id: linkTarget,
        source_port: linkSourcePort ? parseInt(linkSourcePort) : null,
        target_port: linkTargetPort ? parseInt(linkTargetPort) : null,
        source_interface_id: linkSourceIface || null,
        target_interface_id: linkTargetIface || null,
        edge_type: linkType as any,
        created_at: new Date().toISOString(),
        metadata: linkType === 'wireless' ? { ssid_id: linkSSID } : {},
      };

      await driver.saveEdge(newEdge);

      // TODO: 处理 autoResult 的逻辑需要在 StorageDriver 中实现
      // if (res.autoResult?.vlan_id) {
      //   setAutoResult(res.autoResult);
      //   showToast(`自动分配: VLAN ${res.autoResult.vlan_id} (${res.autoResult.vlan_name})${res.autoResult.assigned_ip ? ', IP: ' + res.autoResult.assigned_ip : ''}`, 'success');
      // } else {
      showToast('连接创建成功', 'success');
      setShowLinkForm(false);
      // }

      loadTopology();
    } catch (e) {
      showToast(e instanceof Error ? e.message : '创建失败', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold text-slate-800">网络拓扑</h2>
        <div className="flex gap-2">
          <button onClick={openLinkForm} className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium">
            <Link className="w-4 h-4" /> 创建连接
          </button>
          <button onClick={runValidation} disabled={validating} className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium disabled:opacity-50">
            <ShieldCheck className="w-4 h-4" /> {validating ? '验证中...' : '验证链路'}
          </button>
          <button onClick={() => setShowVlanValidator(!showVlanValidator)} className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium ${showVlanValidator ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}>
            <Route className="w-4 h-4" /> VLAN 验证
          </button>
          <button onClick={loadTopology} className="flex items-center gap-2 px-3 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 text-sm">
            <RefreshCw className="w-4 h-4" /> 刷新
          </button>
        </div>
      </div>

      {/* 图例 */}
      <div className="flex flex-wrap gap-4 text-xs text-slate-500 bg-white rounded-lg border p-3">
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-slate-700"></span>物理连接</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 bg-slate-400"></span>逻辑连接</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 border-t border-dashed border-purple-500"></span>无线连接</span>
        <span className="flex items-center gap-1"><span className="inline-block w-4 h-0.5 border-t border-dotted border-amber-500"></span>管理连接</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-amber-600 rounded-sm"></span>RJ45</span>
        <span className="flex items-center gap-1"><span className="inline-block w-2 h-2 bg-blue-600 rounded-sm"></span>SFP</span>
      </div>

      {/* VLAN 路径验证面板 */}
      {showVlanValidator && (
        <div className="bg-white rounded-xl border p-4">
          <VLANPathValidator entities={nodes} onClose={() => setShowVlanValidator(false)} />
        </div>
      )}

      {/* Cytoscape 容器 */}
      <div className="h-[600px] bg-white rounded-xl border relative overflow-hidden">
        <div ref={containerRef} className="w-full h-full" />
        {nodes.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center text-slate-400">
            暂无拓扑数据，请先添加设备
          </div>
        )}
      </div>

      {/* 选中节点详情 */}
      {selectedNode && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800">{selectedNode.name}</h3>
          <p className="text-sm text-slate-500 mt-1">类型: {CATEGORY_LABELS[selectedNode.category] || selectedNode.category}</p>
        </div>
      )}

      {/* 选中端口详情 */}
      {selectedPort && (
        <div className="bg-white rounded-xl border p-4">
          <h3 className="font-semibold text-slate-800">端口: {selectedPort.nic_name}</h3>
          <p className="text-sm text-slate-500 mt-1">
            类型: {selectedPort.media_type === 'wifi' ? 'WiFi' : selectedPort.connector_type || '未知'}
            {selectedPort.speed && ` | 速率: ${selectedPort.speed}`}
            {` | 状态: ${selectedPort.admin_status === 'up' ? '启用' : '禁用'}`}
          </p>
        </div>
      )}

      {/* 选中链路详情 */}
      {selectedEdge && (
        <div className="bg-white rounded-xl border p-4 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-slate-800">
              {nodes.find(n => n.id === selectedEdge.source_id)?.name || '?'} → {nodes.find(n => n.id === selectedEdge.target_id)?.name || '?'}
            </h3>
            <p className="text-sm text-slate-500 mt-1">
              类型: {selectedEdge.edge_type === 'physical' ? '物理连接' : selectedEdge.edge_type === 'logical' ? '逻辑连接' : selectedEdge.edge_type === 'wireless' ? '无线连接' : selectedEdge.edge_type === 'management' ? '管理连接' : 'VLAN 成员'}
              {selectedEdge.edge_type === 'wireless' && selectedEdge.metadata?.ssid_name ? ` | SSID: ${String(selectedEdge.metadata.ssid_name)}` : null}
              {selectedEdge.source_port != null && ` | 源端口: ${selectedEdge.source_port}`}
              {selectedEdge.target_port != null && ` | 目标端口: ${selectedEdge.target_port}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={() => openEditLink(selectedEdge)} className="flex items-center gap-1.5 px-3 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 text-sm font-medium">
              <Edit className="w-4 h-4" /> 修改
            </button>
            <button onClick={() => handleDeleteEdge(selectedEdge.id)} className="flex items-center gap-1.5 px-3 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100 text-sm font-medium">
              <Trash2 className="w-4 h-4" /> 删除
            </button>
          </div>
        </div>
      )}

      {/* 连线表单 Modal */}
      <Modal open={showLinkForm} onClose={() => setShowLinkForm(false)} title="创建连接" width="max-w-xl">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">上级设备</label>
              <select value={linkSource} onChange={e => { setLinkSource(e.target.value); setLinkSourceIface(''); setCompatMessage(null); if (e.target.value) { loadPorts(e.target.value, setSourcePorts, setSourceInterfaces); if (linkType === 'wireless') { setTargetSSIDs([]); /* TODO: 需要在 StorageDriver 中添加 getWifiSSIDs 方法 */ } } }} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">选择设备</option>
                {nodes.filter(n => { if (linkType === 'wireless') return ['router', 'ap'].includes(n.category); if (linkType === 'management') return n.category === 'ac'; return true; }).map(n => <option key={n.id} value={n.id}>{n.name} ({CATEGORY_LABELS[n.category]})</option>)}
              </select>
              {sourcePorts.length > 0 && (
                <select value={linkSourcePort} onChange={e => setLinkSourcePort(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mt-2">
                  <option value="">选择端口</option>
                  {sourcePorts.map(p => <option key={p.id} value={p.port_number}>Port {p.port_number} {p.vlan_name ? `(VLAN: ${p.vlan_name})` : ''}</option>)}
                </select>
              )}
              {sourceInterfaces.length > 0 && linkType === 'physical' && (
                <select value={linkSourceIface} onChange={e => { setLinkSourceIface(e.target.value); if (e.target.value && linkTargetIface) checkCompat(e.target.value, linkTargetIface); }} className="w-full px-3 py-2 border rounded-lg text-sm mt-2">
                  <option value="">选择网口</option>
                  {sourceInterfaces.map(i => <option key={i.id} value={i.id}>{i.nic_name} ({i.media_type === 'wifi' ? 'WiFi' : i.connector_type || '?'} {i.speed || ''})</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">下级设备</label>
              <select value={linkTarget} onChange={async e => { setLinkTarget(e.target.value); setLinkTargetIface(''); setCompatMessage(null); if (e.target.value) { loadPorts(e.target.value, setTargetPorts, setTargetInterfaces); } else { setTargetSSIDs([]); } }} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">选择设备</option>
                {nodes.filter(n => { if (linkType === 'wireless') return ['phone', 'iot', 'pc', 'camera'].includes(n.category); if (linkType === 'management') return n.category === 'ap'; return true; }).map(n => <option key={n.id} value={n.id}>{n.name} ({CATEGORY_LABELS[n.category]})</option>)}
              </select>
              {targetPorts.length > 0 && (
                <select value={linkTargetPort} onChange={e => setLinkTargetPort(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mt-2">
                  <option value="">选择端口</option>
                  {targetPorts.map(p => <option key={p.id} value={p.port_number}>Port {p.port_number} {p.vlan_name ? `(VLAN: ${p.vlan_name})` : ''}</option>)}
                </select>
              )}
              {targetInterfaces.length > 0 && linkType === 'physical' && (
                <select value={linkTargetIface} onChange={e => { setLinkTargetIface(e.target.value); if (linkSourceIface && e.target.value) checkCompat(linkSourceIface, e.target.value); }} className="w-full px-3 py-2 border rounded-lg text-sm mt-2">
                  <option value="">选择网口</option>
                  {targetInterfaces.map(i => <option key={i.id} value={i.id}>{i.nic_name} ({i.media_type === 'wifi' ? 'WiFi' : i.connector_type || '?'} {i.speed || ''})</option>)}
                </select>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">连接类型</label>
            <select value={linkType} onChange={e => { setLinkType(e.target.value as typeof linkType); setLinkSSID(''); setCompatMessage(null); }} className="w-full px-3 py-2 border rounded-lg text-sm">
              <option value="physical">物理连接</option>
              <option value="logical">逻辑连接</option>
              <option value="wireless">无线连接 (WiFi)</option>
              <option value="management">管理连接 (AC→AP)</option>
            </select>
          </div>
          {linkType === 'wireless' && linkSource && targetSSIDs.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">SSID</label>
              <select value={linkSSID} onChange={e => setLinkSSID(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="">选择 SSID</option>
                {targetSSIDs.map(s => <option key={s.id} value={s.id}>{s.ssid_name}{s.vlan_name ? ` (VLAN: ${s.vlan_name})` : ''}</option>)}
              </select>
            </div>
          )}
          {linkType === 'wireless' && linkSource && targetSSIDs.length === 0 && (
            <div className="rounded-lg p-3 text-sm bg-amber-50 text-amber-700 border border-amber-200">上级设备未配置 SSID，请先在网络管理 &gt; WiFi Tab 中配置</div>
          )}
          {compatMessage && (
            <div className={`rounded-lg p-3 text-sm ${compatMessage.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{compatMessage.text}</div>
          )}
          {autoResult && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-sm">
              <p className="font-medium text-green-800">✓ 自动 VLAN 计算完成</p>
              {autoResult.vlan_id && <p className="text-green-700 mt-1">VLAN: {autoResult.vlan_id} ({autoResult.vlan_name})</p>}
              {autoResult.assigned_ip && <p className="text-green-700">分配 IP: {autoResult.assigned_ip} (子网: {autoResult.subnet_cidr})</p>}
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setShowLinkForm(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">关闭</button>
            <button onClick={handleCreateLink} disabled={compatMessage !== null && !compatMessage.ok} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">创建连接</button>
          </div>
        </div>
      </Modal>

      {/* 验证报告 Modal */}
      <Modal open={showValidation} onClose={() => setShowValidation(false)} title="物理链路验证报告" width="max-w-xl">
        {validationReport && (
          <div className="space-y-4">
            <div className={`rounded-lg p-4 ${validationReport.valid ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
              <p className={`font-medium ${validationReport.valid ? 'text-green-800' : 'text-red-800'}`}>
                {validationReport.valid ? '✓ 所有物理链路验证通过' : `✗ 发现 ${validationReport.summary.errors} 个错误，${validationReport.summary.warnings} 个警告`}
              </p>
            </div>
            {validationReport.issues.length > 0 && (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {validationReport.issues.map((issue, idx) => (
                  <div key={idx} className={`rounded-lg p-3 text-sm border ${issue.severity === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-yellow-50 border-yellow-200 text-yellow-700'}`}>
                    <span className="font-medium">[{issue.severity === 'error' ? '错误' : '警告'}]</span> {issue.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* 编辑链路 Modal */}
      <Modal open={showEditLink} onClose={() => setShowEditLink(false)} title={`修改链路: ${editEdge ? (nodes.find(n => n.id === editEdge.source_id)?.name || '?') + ' → ' + (nodes.find(n => n.id === editEdge.target_id)?.name || '?') : ''}`} width="max-w-xl">
        {editEdge && (
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">连接类型</label>
              <select value={editLinkType} onChange={e => setEditLinkType(e.target.value as 'physical' | 'logical')} className="w-full px-3 py-2 border rounded-lg text-sm">
                <option value="physical">物理连接</option>
                <option value="logical">逻辑连接</option>
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">源: {nodes.find(n => n.id === editEdge.source_id)?.name}</label>
                {editSourcePorts.length > 0 && (
                  <select value={editSourcePort} onChange={e => setEditSourcePort(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mb-2">
                    <option value="">选择端口</option>
                    {editSourcePorts.map(p => <option key={p.id} value={p.port_number}>Port {p.port_number} {p.vlan_name ? `(VLAN: ${p.vlan_name})` : ''}</option>)}
                  </select>
                )}
                {editSourceInterfaces.length > 0 && editLinkType === 'physical' && (
                  <select value={editSourceIface} onChange={e => { setEditSourceIface(e.target.value); if (e.target.value && editTargetIface) checkEditCompat(e.target.value, editTargetIface); }} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">选择网口</option>
                    {editSourceInterfaces.map(i => <option key={i.id} value={i.id}>{i.nic_name} ({i.media_type === 'wifi' ? 'WiFi' : i.connector_type || '?'} {i.speed || ''})</option>)}
                  </select>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">目标: {nodes.find(n => n.id === editEdge.target_id)?.name}</label>
                {editTargetPorts.length > 0 && (
                  <select value={editTargetPort} onChange={e => setEditTargetPort(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm mb-2">
                    <option value="">选择端口</option>
                    {editTargetPorts.map(p => <option key={p.id} value={p.port_number}>Port {p.port_number} {p.vlan_name ? `(VLAN: ${p.vlan_name})` : ''}</option>)}
                  </select>
                )}
                {editTargetInterfaces.length > 0 && editLinkType === 'physical' && (
                  <select value={editTargetIface} onChange={e => { setEditTargetIface(e.target.value); if (editSourceIface && e.target.value) checkEditCompat(editSourceIface, e.target.value); }} className="w-full px-3 py-2 border rounded-lg text-sm">
                    <option value="">选择网口</option>
                    {editTargetInterfaces.map(i => <option key={i.id} value={i.id}>{i.nic_name} ({i.media_type === 'wifi' ? 'WiFi' : i.connector_type || '?'} {i.speed || ''})</option>)}
                  </select>
                )}
              </div>
            </div>
            {editCompatMessage && (
              <div className={`rounded-lg p-3 text-sm ${editCompatMessage.ok ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>{editCompatMessage.text}</div>
            )}
            <div className="flex justify-between pt-2">
              <button onClick={handleReverseEdge} className="px-4 py-2 text-sm text-amber-700 bg-amber-50 hover:bg-amber-100 rounded-lg border border-amber-200 flex items-center gap-1.5">
                <ArrowLeftRight className="w-4 h-4" />交换方向
              </button>
              <div className="flex gap-2">
                <button onClick={() => setShowEditLink(false)} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">取消</button>
                <button onClick={handleSaveEditLink} disabled={editCompatMessage !== null && !editCompatMessage.ok} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed">保存修改</button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
