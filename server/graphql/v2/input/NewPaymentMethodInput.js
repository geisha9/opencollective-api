import { GraphQLInputObjectType, GraphQLNonNull, GraphQLString } from 'graphql';

import { NewPaymentMethodDataInput } from './NewPaymentMethodDataInput';

export const NewPaymentMethodInput = new GraphQLInputObjectType({
  name: 'NewPaymentMethodInput',
  fields: () => ({
    data: { type: new GraphQLNonNull(NewPaymentMethodDataInput) },
    name: { type: new GraphQLNonNull(GraphQLString) },
    service: { type: new GraphQLNonNull(GraphQLString) },
    token: { type: new GraphQLNonNull(GraphQLString) },
    type: { type: new GraphQLNonNull(GraphQLString) },
  }),
});
