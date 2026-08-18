/**
 * 前端 IP 地址计算/校验工具库
 * 基于 ipaddr.js 实现实时校验，无需后端 API 调用
 */
import * as ipaddr from 'ipaddr.js';

/** 校验 IPv4 地址格式是否合法 */
export function isValidIP(ip: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    return addr.kind() === 'ipv4';
  } catch {
    return false;
  }
}

/** 校验 CIDR 格式是否合法（如 192.168.1.0/24） */
export function isValidCIDR(cidr: string): boolean {
  try {
    const [addr, prefix] = ipaddr.parseCIDR(cidr);
    return addr.kind() === 'ipv4' && prefix >= 0 && prefix <= 32;
  } catch {
    return false;
  }
}

/** 检查 IP 是否在指定子网内 */
export function isIPInSubnet(ip: string, cidr: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    const [network, prefix] = ipaddr.parseCIDR(cidr);
    return addr.match([network, prefix]);
  } catch {
    return false;
  }
}

/** IP 地址转数字（用于排序和范围计算） */
export function ipToNumber(ip: string): number {
  const parts = ip.split('.').map(Number);
  return ((parts[0]! << 24) | (parts[1]! << 16) | (parts[2]! << 8) | parts[3]!) >>> 0;
}

/** 数字转 IP 地址 */
export function numberToIP(num: number): string {
  return `${(num >>> 24) & 255}.${(num >>> 16) & 255}.${(num >>> 8) & 255}.${num & 255}`;
}

/** 计算子网可用主机范围 */
export function getHostRange(cidr: string): { network: string; broadcast: string; first: string; last: string; total: number } | null {
  try {
    const [network, prefix] = ipaddr.parseCIDR(cidr);
    if (network.kind() !== 'ipv4') return null;

    const netNum = ipToNumber(network.toString());
    const hostBits = 32 - prefix;
    const hostCount = Math.pow(2, hostBits);
    const broadcastNum = netNum + hostCount - 1;

    if (prefix >= 31) {
      // /31 或 /32 特殊处理
      return {
        network: numberToIP(netNum),
        broadcast: numberToIP(broadcastNum),
        first: numberToIP(netNum),
        last: numberToIP(broadcastNum),
        total: hostCount,
      };
    }

    return {
      network: numberToIP(netNum),
      broadcast: numberToIP(broadcastNum),
      first: numberToIP(netNum + 1),
      last: numberToIP(broadcastNum - 1),
      total: hostCount - 2, // 去掉网络地址和广播地址
    };
  } catch {
    return null;
  }
}

/** 建议默认网关（子网第一个可用地址，通常是 .1） */
export function suggestGateway(cidr: string): string | null {
  const range = getHostRange(cidr);
  if (!range) return null;
  return range.first;
}

/** 将前缀长度转为点分十进制子网掩码 */
export function prefixToNetmask(prefix: number): string {
  if (prefix < 0 || prefix > 32) return '';
  const mask = prefix === 0 ? 0 : (~0 << (32 - prefix)) >>> 0;
  return numberToIP(mask);
}

/** 校验网关 IP 是否合法 */
export function validateGateway(gateway: string, cidr: string): { valid: boolean; error?: string } {
  if (!gateway) return { valid: true }; // 空值允许
  if (!isValidIP(gateway)) return { valid: false, error: 'IP 地址格式不合法' };
  if (!isValidCIDR(cidr)) return { valid: true }; // CIDR 不合法时不校验范围

  if (!isIPInSubnet(gateway, cidr)) {
    return { valid: false, error: `网关 ${gateway} 不在子网 ${cidr} 范围内` };
  }

  // 检查是否是网络地址或广播地址
  const range = getHostRange(cidr);
  if (range) {
    if (gateway === range.network) return { valid: false, error: '不能使用网络地址作为网关' };
    if (gateway === range.broadcast) return { valid: false, error: '不能使用广播地址作为网关' };
  }

  return { valid: true };
}

/** 校验手动分配的 IP 地址 */
export function validateIPAssignment(ip: string, cidr: string): { valid: boolean; error?: string } {
  if (!isValidIP(ip)) return { valid: false, error: 'IP 地址格式不合法' };
  if (!isIPInSubnet(ip, cidr)) {
    return { valid: false, error: `${ip} 不在子网 ${cidr} 范围内` };
  }
  const range = getHostRange(cidr);
  if (range) {
    if (ip === range.network) return { valid: false, error: '不能分配网络地址' };
    if (ip === range.broadcast) return { valid: false, error: '不能分配广播地址' };
  }
  return { valid: true };
}

/** 计算子网 IP 使用率摘要 */
export function calcSubnetUsage(cidr: string, assignedCount: number): { total: number; used: number; available: number; percent: number } {
  const range = getHostRange(cidr);
  const total = range?.total || 0;
  const used = assignedCount;
  const available = Math.max(0, total - used);
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return { total, used, available, percent };
}
