/**
 * Graphology 内存图管理
 * 启动时从 IndexedDB 加载 entities + edges 构建拓扑图
 * 写操作时同步更新内存图（双写）
 */
import Graph from 'graphology';
import { db } from './db';
import type { Entity, Edge } from '../types';

// 多重图：允许两节点间多条边（物理+逻辑+VLAN成员）
export const infraGraph = new Graph({ multi: true, type: 'undirected' });

/** 应用启动时调用，从 IndexedDB 构建完整图 */
export async function buildGraph(): Promise<void> {
  infraGraph.clear();

  const [entities, edges] = await Promise.all([
    db.entities.toArray(),
    db.edges.toArray(),
  ]);

  for (const entity of entities) {
    if (!infraGraph.hasNode(entity.id)) {
      infraGraph.addNode(entity.id, {
        name: entity.name,
        type: entity.type,
        category: entity.category,
      });
    }
  }

  for (const edge of edges) {
    if (!infraGraph.hasNode(edge.source_id) || !infraGraph.hasNode(edge.target_id)) continue;
    try {
      infraGraph.addEdgeWithKey(edge.id, edge.source_id, edge.target_id, {
        type: edge.edge_type,
        srcIface: edge.source_interface_id,
        tgtIface: edge.target_interface_id,
        metadata: edge.metadata,
      });
    } catch {
      // 忽略重复边（key 冲突）
    }
  }
}

/** 添加节点到内存图 */
export function addNodeToGraph(entity: Entity): void {
  if (infraGraph.hasNode(entity.id)) {
    infraGraph.replaceNodeAttributes(entity.id, {
      name: entity.name,
      type: entity.type,
      category: entity.category,
    });
  } else {
    infraGraph.addNode(entity.id, {
      name: entity.name,
      type: entity.type,
      category: entity.category,
    });
  }
}

/** 从内存图移除节点（同时移除关联边） */
export function removeNodeFromGraph(id: string): void {
  if (infraGraph.hasNode(id)) {
    infraGraph.dropNode(id);
  }
}

/** 添加边到内存图 */
export function addEdgeToGraph(edge: Edge): void {
  if (!infraGraph.hasNode(edge.source_id) || !infraGraph.hasNode(edge.target_id)) return;
  if (infraGraph.hasEdge(edge.id)) {
    infraGraph.replaceEdgeAttributes(edge.id, {
      type: edge.edge_type,
      srcIface: edge.source_interface_id,
      tgtIface: edge.target_interface_id,
      metadata: edge.metadata,
    });
  } else {
    try {
      infraGraph.addEdgeWithKey(edge.id, edge.source_id, edge.target_id, {
        type: edge.edge_type,
        srcIface: edge.source_interface_id,
        tgtIface: edge.target_interface_id,
        metadata: edge.metadata,
      });
    } catch { /* 忽略重复 key */ }
  }
}

/** 从内存图移除边 */
export function removeEdgeFromGraph(id: string): void {
  if (infraGraph.hasEdge(id)) {
    infraGraph.dropEdge(id);
  }
}

/** 获取物理子图（仅 physical 类型边） */
export function getPhysicalSubgraph(): Graph {
  const sub = new Graph({ multi: false, type: 'undirected' });
  infraGraph.forEachNode((node, attrs) => {
    sub.addNode(node, attrs);
  });
  infraGraph.forEachEdge((edge, attrs, source, target) => {
    if (attrs.type === 'physical') {
      sub.addEdgeWithKey(edge, source, target, attrs);
    }
  });
  return sub;
}
