import { GraphQLInt, GraphQLNonNull, GraphQLString } from 'graphql';

import activities from '../../../constants/activities';
import status from '../../../constants/order_status';
import models from '../../../models';
import { setupCreditCard } from '../../../paymentProviders/stripe/creditcard';
import { NotFound, Unauthorized } from '../../errors';
import { getDecodedId } from '../identifiers';
import { NewPaymentMethodInput } from '../input/NewPaymentMethodInput';
import { OrderReferenceInput } from '../input/OrderReferenceInput';
import { PaymentMethodReferenceInput } from '../input/PaymentMethodReferenceInput';
import { Order } from '../object/Order';

const modelArray = [
  { model: models.Subscription },
  { model: models.Collective, as: 'collective' },
  { model: models.Collective, as: 'fromCollective' },
];

const orderMutations = {
  cancelOrder: {
    type: Order,
    description: 'Cancel an order',
    args: {
      order: {
        type: new GraphQLNonNull(OrderReferenceInput),
        description: 'Object matching the OrderReferenceInput (id)',
      },
    },
    async resolve(_, args, req) {
      const decodedId = getDecodedId(args.order.id);

      if (!req.remoteUser) {
        throw new Unauthorized('You need to be logged in to cancel a recurring contribution');
      }

      const query = {
        where: {
          id: decodedId,
        },
        include: modelArray,
      };

      const order = await models.Order.findOne(query);

      if (!order) {
        throw new NotFound('Recurring contribution not found');
      }
      if (!req.remoteUser.isAdmin(order.FromCollectiveId)) {
        throw new Unauthorized("You don't have permission to cancel this recurring contribution");
      }
      if (!order.Subscription.isActive && order.status === status.CANCELLED) {
        throw new Error('Recurring contribution already canceled');
      }

      await order.update({ status: status.CANCELLED });
      await order.Subscription.deactivate();
      await models.Activity.create({
        type: activities.SUBSCRIPTION_CANCELED,
        CollectiveId: order.CollectiveId,
        UserId: order.CreatedByUserId,
        data: {
          subscription: order.Subscription,
          collective: order.collective.minimal,
          user: req.remoteUser.minimal,
          fromCollective: order.fromCollective.minimal,
        },
      });

      return models.Order.findOne(query);
    },
  },
  activateOrder: {
    type: Order,
    description: 'Reactivate a cancelled order',
    args: {
      order: {
        type: new GraphQLNonNull(OrderReferenceInput),
        description: 'Object matching the OrderReferenceInput (id)',
      },
    },
    async resolve(_, args, req) {
      const decodedId = getDecodedId(args.order.id);

      if (!req.remoteUser) {
        throw new Unauthorized('You need to be logged in to activate a recurring contribution');
      }

      const query = {
        where: {
          id: decodedId,
        },
        include: modelArray,
      };

      const order = await models.Order.findOne(query);

      if (!order) {
        throw new NotFound('Recurring contribution not found');
      }
      if (!req.remoteUser.isAdmin(order.FromCollectiveId)) {
        throw new Unauthorized("You don't have permission to cancel this recurring contribution");
      }
      if (order.Subscription.isActive && order.status === status.ACTIVE) {
        throw new Error('Recurring contribution already active');
      }

      await order.update({ status: status.ACTIVE });
      await order.Subscription.activate();
      await models.Activity.create({
        type: activities.SUBSCRIPTION_ACTIVATED,
        CollectiveId: order.CollectiveId,
        UserId: order.CreatedByUserId,
        data: {
          subscription: order.Subscription,
          collective: order.collective.minimal,
          user: req.remoteUser.minimal,
          fromCollective: order.fromCollective.minimal,
        },
      });

      return models.Order.findOne(query);
    },
  },
  updateOrder: {
    type: Order,
    description: "Update an Order's amount, tier, payment method, or frequency",
    args: {
      order: {
        type: new GraphQLNonNull(OrderReferenceInput),
        description: 'Object matching the OrderReferenceInput (id)',
      },
      amount: {
        type: GraphQLInt,
        description: 'Amount in cents of the order',
      },
      frequency: {
        type: GraphQLString,
        description: 'Frequency of the recurring order, either MONTHLY or YEARLY',
      },
      tier: {
        type: GraphQLString,
        description: 'The tier of the recurring contribution, like Backer or Sponsor',
      },
      paymentMethod: {
        type: PaymentMethodReferenceInput,
        description: 'Object matching the PaymentMethodReferenceInput (uuid)',
      },
    },
    async resolve(_, args, req) {
      const decodedId = getDecodedId(args.order.id);

      if (!req.remoteUser) {
        throw new Unauthorized('You need to be logged in to update a subscription');
      }

      const { paymentMethod } = args;

      const query = {
        where: {
          id: decodedId,
        },
        include: [{ model: models.Subscription }, { model: models.PaymentMethod, as: 'paymentMethod' }],
      };

      let order = await models.Order.findOne(query);

      if (!order) {
        throw new NotFound('Subscription not found');
      }
      if (!req.remoteUser.isAdmin(order.FromCollectiveId)) {
        throw new Unauthorized("You don't have permission to update this subscription");
      }
      if (!order.Subscription.isActive) {
        throw new Error('Subscription must be active to be updated');
      }

      // payment method
      if (paymentMethod !== undefined) {
        // unlike v1 we don't have to check/assign new payment method, that will be taken care of in another mutation
        const newPaymentMethod = await models.PaymentMethod.findOne({
          where: { uuid: paymentMethod.uuid },
        });
        if (!newPaymentMethod) {
          throw new Error('Payment method not found with this uuid', paymentMethod.uuid);
        }
        if (!req.remoteUser.isAdmin(paymentMethod.CollectiveId)) {
          throw new Unauthorized("You don't have permission to use this payment method");
        }

        order = await order.update({ PaymentMethodId: newPaymentMethod.id });
      }

      return order;
    },
  },
  addPaymentMethod: {
    type: Order,
    description: 'Add a new payment method to be used with an Order',
    args: {
      newPaymentMethod: {
        type: NewPaymentMethodInput,
        description: 'Object matching the NewPaymentMethodInput',
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
        service: newPaymentMethod.service || 'stripe',
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

export default orderMutations;
