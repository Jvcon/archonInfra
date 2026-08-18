/**
 * 网络计算纯函数（前端版）
 * 从 worker/network.ts 提取，不依赖任何数据库
 */
import ipaddr from 'ipaddr.js';

/** 解析 CIDR 获取网络地址和前缀长度 */
export function parseCIDR(cidr: string): { network: string; prefix: number } {
  const [addr, prefix] = ipaddr.parseCIDR(cidr);
  return { network: addr.toString(), prefix };
}

/** 检查 IP 是否在指定子网内 */
export function isInSubnet(ip: string, cidr: string): boolean {
  try {
    const addr = ipaddr.parse(ip);
    const [network, bits] = ipaddr.parseCIDR(cidr);
    return addr.match([network, bits]);
  } catch {
    return false;
  }
}

/** 计算子网内所有可用主机地址 */
export function getHostRange(cidr: string): { first: string; last: string; total: number } {
  const [network, bits] = ipaddr.parseCIDR(cidr);
  const kind = network.kind();

  if (kind === 'ipv4') {
    const netBytes = (network as ipaddr.IPv4).toByteArray() as [number, number, number, number];
    const hostBits = 32 - bits;
    const totalHosts = Math.pow(2, hostBits) - 2;

    const firstBytes = [...netBytes] as [number, number, number, number];
    firstBytes[3]! += 1;

    const lastNum = netBytes.reduce((a, b) => (a << 8) + b, 0) + Math.pow(2, hostBits) - 2;
    const lastBytes = [(lastNum >> 24) & 0xff, (lastNum >> 16) & 0xff, (lastNum >> 8) & 0xff, lastNum & 0xff];

    return {
      first: firstBytes.join('.'),
      last: lastBytes.join('.'),
      total: Math.max(totalHosts, 0),
    };
  }

  return { first: network.toString(), last: network.toString(), total: 0 };
}

/** IP 地址转为数值（用于排序和范围比较） */
export function ipToLong(ip: string): number {
  const parts = ip.split('.').map(Number);
  return parts.reduce((a, b) => (a << 8) + b, 0) >>> 0;
}

/** 数值转回 IP 地址字符串 */
export function longToIp(num: number): string {
  return `${(num >>> 24) & 0xff}.${(num >>> 16) & 0xff}.${(num >>> 8) & 0xff}.${num & 0xff}`;
}
