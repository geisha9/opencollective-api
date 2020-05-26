import { GraphQLInputObjectType, GraphQLInt, GraphQLString } from 'graphql';

export const PaymentMethodReferenceInput = new GraphQLInputObjectType({
  name: 'PaymentMethodReferenceInput',
  fields: () => ({
    uuid: {
      type: GraphQLString,
      description: 'The uuid string assigned to the payment method',
    },
    CollectiveId: {
      type: GraphQLInt,
      description: 'The Collective Id that owns the payment method',
    },
  }),
});
