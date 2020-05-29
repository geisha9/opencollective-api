import { GraphQLEnumType, GraphQLInt, GraphQLNonNull, GraphQLString } from 'graphql';

import models from '../../../models';
import { setupCreditCard } from '../../../paymentProviders/stripe/creditcard';
import { NotFound, Unauthorized } from '../../errors';
import { PaymentMethodCreateInput } from '../input/PaymentMethodCreateInput';
import { PaymentMethod } from '../object/PaymentMethod';

const paymentMethodMutations = {
  addStripeCreditCard: {
    type: PaymentMethod,
    description: 'Add a new payment method to be used with an Order',
    args: {
      newPaymentMethod: {
        type: PaymentMethodCreateInput,
        description: 'Reference to a Payment Method to add to an Account',
      },
    },
    async resolve(_, args, req) {
      const collective = await models.Collective.findByPk(req.remoteUser.CollectiveId);
      if (!collective) {
        throw Error('This collective does not exist');
      }

      const { newPaymentMethod } = args;

      const newPaymentMethodData = {
        ...newPaymentMethod,
        service: 'stripe',
        type: 'creditcard',
        CreatedByUserId: req.remoteUser.id,
        currency: args.currency || collective.currency,
        saved: true,
        CollectiveId: req.remoteUser.CollectiveId,
      };

      let pm = await models.PaymentMethod.create(newPaymentMethodData);

      try {
        pm = await setupCreditCard(pm, {
          collective,
          user: req.remoteUser,
        });
      } catch (error) {
        if (!error.stripeResponse) {
          throw error;
        }

        pm.stripeError = {
          message: error.message,
          response: error.stripeResponse,
        };
      }
      return pm;
    },
  },
};

export default paymentMethodMutations;
