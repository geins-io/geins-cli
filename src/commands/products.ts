import { request } from '../api/client.ts';

export interface Product {
  _id: string;
  _type: string;
  name: string;
  articleNumber: string;
  active: boolean;
  purchasePrice: number;
  purchasePriceCurrency: string;
  brand: { _id: string; _type: string } | null;
  mainCategoryId: string;
  freightClassId: string;
  intrastatCode: string;
  countryOfOrigin: string;
  externalProductId: string;
  maxDiscountPercentage: number;
  dateCreated: string;
  dateUpdated: string;
  dateFirstAvailable: string | null;
  dateActivated: string | null;
}

export async function getProduct(id: string): Promise<Product> {
  return request<Product>(`/product/${id}`);
}
